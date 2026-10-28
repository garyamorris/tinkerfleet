import { MemoryStore, MemoryError } from './memory.js';
import {
  SCHEDULE_LIMITS,
  ScheduleError,
  ScheduleStore,
  dueSlot,
  scheduleRefusal,
  scheduleView,
} from './schedules.js';
import { randomAppearance } from '../shared/appearance.js';
import { safeSources } from './sources.js';
import { runtimeConfig, type RuntimeOptions } from './config.js';
import type { Model } from '@openai/agents';
import { validateParticipants, validateAvailableBots, validateProfiles } from './personas.js';
import { splitCreatedCapabilities, withLibraryCapabilities } from '../shared/capabilities.js';
import {
  ConversationStore,
  CONVERSATION_LIMITS,
  conversationHistory,
  defaultParticipants,
  selectCoordinatorGroup,
} from './conversations.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { DemoModel, createDemoWorkspace } from './demo.js';
import { createSecurity, HttpError, json, readJson } from './http.js';
import { canonicalJson } from './approval.js';
import { ApprovalStore } from './approval.js';
import { NativeWorkspaceRunner } from './native-runner.js';
import {
  createSdkAdapter,
  redactSdkText,
  TraceStore,
  type SdkEvent,
  type SdkStatus,
  type SdkStartGroupRequest,
  type SdkStartedGroup,
} from './sdk.js';
import type {
  AppState,
  Run,
  AgentId,
  Action,
  Capability,
  Conversation,
  Persona,
} from '../shared/types.js';

const isPrimary = (p: Persona) => p.role === 'coordinator';
const ONE_PRIMARY =
  'There is already a primary agent. Edit it, or create an ordinary agent instead.';

export function createApp(
  options: RuntimeOptions & {
    sdkModel?: Model;
    port: number;
    mode?: 'demo' | 'live';
    workspaceRoot?: string;
    production?: boolean;
    demoDelayMs?: number;
    statePath?: string;
    initialRuns?: Run[];
    /** The time schedules are checked against. Tests and the lesson pass a fixed clock. */
    clock?: () => number;
    serve?: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  },
) {
  const mode = options.mode ?? (process.env.TINKERFLEET_MODE === 'live' ? 'live' : 'demo');
  // The demo runs the real agent loop, tools and approvals with a scripted model (demo.ts),
  // on a temporary copy of tiny-project that is deleted when the server closes.
  const demo = mode === 'demo';
  const config = runtimeConfig(
    demo
      ? {
          ...options,
          workspaceToolsEnabled: options.workspaceToolsEnabled ?? true,
          webSearchEnabled: false,
        }
      : options,
  );
  const sdkModel = options.sdkModel ?? (demo ? new DemoModel(options.demoDelayMs) : undefined);
  const model = options.sdkModel
    ? 'offline-scripted-model'
    : process.env.TINKERFLEET_MODEL?.trim() || null;
  const modelReady = () => !!sdkModel || (!!model && !!process.env.OPENAI_API_KEY);
  const demoWorkspace =
    demo && config.workspaceToolsEnabled && !options.workspaceRoot
      ? createDemoWorkspace()
      : undefined;
  const root =
    demoWorkspace ??
    path.resolve(
      options.workspaceRoot ??
        (demo ? undefined : process.env.TINKERFLEET_WORKSPACE) ??
        'examples/tiny-project',
    );
  const store = new ConversationStore(options.statePath, options.initialRuns);
  const memory = new MemoryStore(
    options.statePath ? `${options.statePath}.memories.json` : undefined,
  );
  const schedules = new ScheduleStore(
    options.statePath ? `${options.statePath}.schedules.json` : undefined,
  );
  const clock = options.clock ?? Date.now;
  // Only live mode runs schedules. The demo shows and saves them, but never fires them.
  const schedulesRun = mode === 'live';
  let profiles = store.state.profiles;
  let libraryImported = store.state.libraryImported;
  const sentMessages = new Map<string, Map<string, { conversationId: string; agentId: string }>>();
  const createdAgents = new Map<string, Map<string, Persona>>();
  const conversations = new Map(store.state.conversations.map((chat) => [chat.id, chat]));
  const runsById = new Map<string, Run>();
  for (const run of store.state.runs) runsById.set(run.id, run);
  const legacyRunIds = new Set<string>();
  const groupRequests = new Map<string, string>();
  const approvals = new ApprovalStore();
  // What each model call sent and got back, for the trace viewer. Memory only, never saved.
  const traces = new TraceStore();
  const runner = config.workspaceToolsEnabled
    ? new NativeWorkspaceRunner({ workspaceRoot: root, approvals })
    : undefined;
  function workspaceRunner() {
    if (!runner) throw new Error('Workspace tools are disabled.');
    return runner;
  }
  const beforeCache = new Map<string, string>();
  const starting = new Set<string>();
  let persistenceError: string | undefined;
  let closing = false;
  const security = createSecurity(options.port);
  let currentRunId: string | null = null;
  let execution = {
    available: false,
    reason: config.workspaceToolsEnabled
      ? 'Local workspace has not been checked yet.'
      : 'Workspace tools are disabled; chat needs no local execution.',
  };
  let executionProbe = 0;
  async function checkExecution() {
    if (!runner) return;
    const version = ++executionProbe;
    try {
      const availability = await runner.checkAvailability();
      if (!closing && version === executionProbe)
        execution = { available: availability.available, reason: availability.reason ?? 'Ready' };
      return availability;
    } catch {
      const unavailable = {
        available: false,
        reason: 'The selected local workspace could not be checked.',
      };
      if (!closing && version === executionProbe) execution = unavailable;
      return unavailable;
    }
  }
  const participantId = (persona?: Persona) =>
    persona?.role === 'coordinator' ? 'coordinator' : (persona?.id ?? 'coordinator');
  function toolActivity(tool: string | undefined, finished: boolean): string {
    const labels: Record<string, [string, string]> = {
      list_files: ['Listing workspace files', 'File listing finished'],
      read_file: ['Reading a workspace file', 'File read finished'],
      edit_file: ['Editing a workspace file', 'File edit finished'],
      run_command: ['Running a local command', 'Local command finished'],
      create_agent: ['Creating an agent', 'Agent creation finished'],
      message_agent: ['Sending a message to an agent', 'Agent message delivery finished'],
      start_group_conversation: ['Starting a group conversation', 'Group setup finished'],
      recall_memory: ['Reading saved memories', 'Memories recalled'],
      remember_memory: ['Saving a memory', 'Memory saved'],
      forget_memory: ['Forgetting a memory', 'Memory forgotten'],
      web_search: ['Searching the web', 'Web search finished'],
      web_open_page: ['Opening a web page', 'Web page request finished'],
      web_find_in_page: ['Finding text in a web page', 'Page search finished'],
    };
    if (tool && labels[tool]) return labels[tool][finished ? 1 : 0];
    if (tool?.startsWith('ask_'))
      return finished ? 'Agent consultation finished' : 'Consulting another agent';
    return finished ? 'Tool operation finished' : 'Using a tool';
  }
  function onEvent(e: SdkEvent) {
    const run = runsById.get(e.runId);
    if (!run) return;
    const agent = e.agent ?? run.activeAgent ?? participantId(run.team?.[0]);
    const displayName =
      run.team?.find((persona) => participantId(persona) === agent)?.name ??
      e.agent ??
      'Coordinator';
    if (e.type === 'usage') {
      if (e.usage) run.usage = { ...e.usage };
      return;
    }
    if (e.type === 'agent_message') {
      if (e.message)
        run.messages.push({
          id: randomUUID(),
          at: Date.parse(e.at),
          author: agent,
          text: redactSdkText(e.message),
          ...(e.sources?.length
            ? { sources: safeSources(e.sources, redactSdkText(e.message)) }
            : {}),
          kind: 'result',
        });
      touch(run);
      return;
    }
    const labels: Record<string, string> = {
      run_started: 'Run started',
      agent_started: `${displayName} started`,
      agent_finished: `${displayName} returned`,
      tool_started: toolActivity(e.tool, false),
      tool_finished: toolActivity(e.tool, true),
      approval_requested: 'Your approval is needed',
      approval_resolved: e.approved ? 'Action approved' : 'Action declined',
      run_completed: 'Run complete',
      run_failed: 'Run could not finish',
      run_cancelled: 'Run stopped',
    };
    run.events.push({
      id: randomUUID(),
      at: Date.parse(e.at),
      agent,
      kind: e.type.startsWith('approval')
        ? 'approval'
        : e.type.startsWith('tool')
          ? 'tool'
          : e.type.startsWith('agent')
            ? 'delegation'
            : e.type === 'run_failed'
              ? 'error'
              : 'result',
      title: labels[e.type] ?? e.type,
      detail: e.message ?? e.tool,
    });
    if (e.type === 'agent_started') run.activeAgent = agent;
    if (e.type === 'approval_requested' && e.approval) {
      const p = e.approval;
      const bound = approvals.get(p.approvalId)?.action;
      const action =
        p.action.kind === 'command' &&
        bound &&
        typeof bound === 'object' &&
        'resolvedExecutable' in bound
          ? {
              ...p.action,
              resolvedExecutable: bound.resolvedExecutable as {
                path: string;
                identity: string;
              } | null,
            }
          : p.action;
      run.status = 'awaiting_approval';
      run.approvals.push({
        id: p.approvalId,
        digest: p.digest,
        agent,
        title: p.action.kind === 'edit' ? `Update ${p.action.path}` : `Run ${p.action.executable}`,
        // What happens on approval depends on the mode; the card says that part.
        description:
          p.action.kind === 'edit'
            ? `Review the exact change to ${p.action.path}. Nothing is written until you approve.`
            : 'Review the exact program, arguments, and folder. Nothing runs until you approve.',
        action,
        status: 'pending',
        before: beforeCache.get(p.approvalId),
        requestedAt: Date.parse(e.at),
      });
    }
    if (e.type === 'approval_resolved') {
      const p = run.approvals.find((a) => a.id === e.approvalId);
      if (p) {
        p.status = e.approved ? 'approved' : 'denied';
        p.decidedAt ??= Date.parse(e.at);
      }
      run.status = 'running';
    }
    if (e.type === 'run_completed') {
      run.status = 'completed';
      run.activeAgent = null;
      run.endedAt = Date.now();
    }
    if (e.type === 'run_failed' || e.type === 'run_cancelled') {
      run.status = e.type === 'run_failed' ? 'failed' : 'cancelled';
      run.activeAgent = null;
      run.endedAt = Date.now();
      for (const a of run.approvals)
        if (a.status === 'pending') {
          a.status = 'denied';
          a.decidedAt = Date.parse(e.at);
        }
      if (e.message)
        run.messages.push({ id: randomUUID(), at: Date.now(), author: agent, text: e.message });
    }
    touch(run);
    if (['run_completed', 'run_failed', 'run_cancelled'].includes(e.type))
      runner?.disposeRun(run.id);
  }
  const sdk = createSdkAdapter({
    memory: {
      list: (id) => memory.list(id),
      remember: async (id, text) => memory.remember(id, text),
      forget: async (id, entryId) => memory.forget(id, entryId),
    },
    workspaceRoot: root,
    webSearchEnabled: mode === 'live' && config.webSearchEnabled,
    model: sdkModel ?? model ?? undefined,
    workspaceToolsEnabled: config.workspaceToolsEnabled,
    reasoningEffort: config.reasoningEffort ?? undefined,
    limits: config.limits,
    liveEnabled: mode === 'live',
    onEvent,
    trace: traces,
    startGroup,
    createAgent,
    messageAgent,
    harness: {
      snapshot: (id) => workspaceRunner().snapshot(id),
      readFile: (id, p) => workspaceRunner().readFile(id, p),
      prepare: async (id, action) => {
        const record = await workspaceRunner().prepare(id, action);
        if (action.kind === 'edit')
          beforeCache.set(
            record.id,
            redactSdkText(
              await workspaceRunner()
                .readFile(id, action.path)
                .catch(() => ''),
            ),
          );
        return record;
      },
      decide: (id, approvalId, digest, approved) =>
        approvals.decide(id, approvalId, digest, approved),
      execute: async (id, approvalId, opts) => {
        const record = approvals.get(approvalId);
        const a = record?.action as Action | undefined;
        const before =
          a?.kind === 'edit'
            ? await workspaceRunner()
                .readFile(id, a.path)
                .catch(() => '')
            : '';
        const result = await workspaceRunner().execute(id, approvalId, opts);
        const run = runsById.get(id);
        if (run) {
          if (a?.kind === 'edit' && result.status === 'completed')
            run.artifacts.push({
              path: a.path,
              before,
              after: redactSdkText(a.content),
              simulated: false,
            });
          if (a?.kind === 'command')
            run.output = redactSdkText(
              `$ ${a.executable} ${a.args.join(' ')}\n${result.stdout}\n${result.stderr}\nStatus: ${result.status} · exit code ${result.exitCode ?? 'none'}\nProcess group stopped: ${result.cleanupSucceeded ? 'yes' : 'no'}`,
            );
        }
        return result;
      },
      cancel: (id) => runner?.cancel(id),
    },
  });
  function sync(s: SdkStatus) {
    const r = runsById.get(s.runId);
    if (!r) return;
    r.usage = { ...s.usage };
    r.status = s.status === 'error' || s.status === 'deferred' ? 'failed' : s.status;
    for (const p of s.pendingApprovals) {
      const a = r.approvals.find((a) => a.id === p.approvalId);
      if (a && a.action.kind === 'edit')
        void workspaceRunner()
          .readFile(r.id, a.action.path)
          .then((before) => (a.before = redactSdkText(before)))
          .catch(() => {});
    }
    if (s.status === 'deferred' && s.message)
      r.messages.push({
        id: randomUUID(),
        author: r.activeAgent ?? participantId(r.team?.[0]),
        text: s.message,
        at: Date.now(),
      });
  }
  const allRuns = () => [...runsById.values()];
  const findRun = (id: string) => runsById.get(id);
  function touch(run: Run) {
    const chat = run.conversationId ? conversations.get(run.conversationId) : undefined;
    if (chat) chat.updatedAt = Date.now();
  }
  function relayAgentReplies() {
    for (const child of allRuns()) {
      if (
        !child.sentBy ||
        !['awaiting_approval', 'completed', 'failed', 'cancelled', 'denied'].includes(child.status)
      )
        continue;
      const source = findRun(child.sentBy.runId),
        agent = child.team?.[0];
      if (!source || !agent) continue;
      const response =
        child.status === 'awaiting_approval'
          ? 'Waiting for your approval in the agent conversation.'
          : child.messages
              .filter((m) => m.author === agent.id)
              .map((m) => m.text)
              .join('\n')
              .slice(-4000) || `Run ${child.status}.`;
      const text = redactSdkText(`${agent.name}: ${response}`);
      if (source.messages.some((m) => m.replyToRunId === child.id && m.text === text)) continue;
      source.messages.push({
        id: randomUUID(),
        author: agent.id,
        replyToRunId: child.id,
        text,
        kind: 'result',
        at: Date.now(),
      });
      touch(source);
    }
  }
  function persist(required = false) {
    relayAgentReplies();
    for (const run of allRuns()) {
      const chat = run.conversationId ? conversations.get(run.conversationId) : undefined;
      if (chat)
        chat.updatedAt = Math.max(
          chat.updatedAt,
          run.startedAt,
          run.endedAt ?? 0,
          ...run.messages.map((m) => m.at),
          ...run.events.map((e) => e.at),
        );
    }
    try {
      store.save([...conversations.values()], allRuns(), profiles, libraryImported);
      persistenceError = undefined;
    } catch {
      persistenceError =
        'Conversation history could not be saved. Check local storage before continuing.';
      if (required) throw new HttpError(503, persistenceError);
    }
  }
  function state(): AppState {
    const now = clock();
    return {
      memories: memory.list(),
      schedules: schedules.list().map((s) => scheduleView(s, now)),
      schedulesRun,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      webSearchEnabled: mode === 'live' && config.webSearchEnabled,
      profiles,
      workspaceToolsEnabled: config.workspaceToolsEnabled,
      reasoningEffort: config.reasoningEffort,
      limits: config.limits,
      conversations: [...conversations.values()],
      ...(persistenceError ? { persistenceError } : {}),
      mode,
      model: mode === 'live' ? model : null,
      workspace: path.basename(root),
      workspaceRoot: root,
      execution,
      liveReady:
        mode === 'live' && modelReady() && (!config.workspaceToolsEnabled || execution.available),
      runs: allRuns(),
      currentRunId,
      maxTurns: config.limits.maxTurns,
    };
  }
  function validTitle(value: unknown) {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.trim().length > 80 ||
      /[\u0000-\u001f\u007f]/.test(value)
    )
      throw new HttpError(400, 'Enter a title of 1–80 characters.');
    return redactSdkText(value.trim());
  }
  function startRun(
    value: unknown,
    chat: Conversation,
    res?: ServerResponse,
    legacy = false,
    promptAuthor: AgentId | 'user' = 'user',
    beforePublish?: (run: Run) => void,
  ) {
    if (typeof value !== 'string' || !value.trim() || value.length > 8000)
      throw new HttpError(400, 'Enter a task of 1–8,000 characters.');
    if (
      starting.has(chat.id) ||
      allRuns().some(
        (run) =>
          run.conversationId === chat.id && ['running', 'awaiting_approval'].includes(run.status),
      )
    )
      throw new HttpError(409, 'Finish or stop this conversation’s current run first.');
    if (allRuns().length >= CONVERSATION_LIMITS.runs)
      throw new HttpError(409, 'Saved run limit reached. Existing history was preserved.');
    if (!beforePublish) persist(true);
    starting.add(chat.id);
    const previousRoster = chat.availableBots;
    try {
      if (
        (profiles.some((p) => p.role !== 'coordinator') || chat.availableBots) &&
        chat.participants.length === 1 &&
        chat.participants[0].role === 'coordinator' &&
        !chat.startedBy
      )
        chat.availableBots = validateAvailableBots(
          [
            ...(chat.availableBots ?? []),
            ...profiles.filter(
              (p) =>
                p.role !== 'coordinator' && !chat.availableBots?.some((old) => old.id === p.id),
            ),
          ].slice(0, 32),
        );
      const prompt = redactSdkText(value.trim()),
        team = validateParticipants(chat.participants),
        history = conversationHistory(chat.id, allRuns());
      const run: Run = {
        id: randomUUID(),
        prompt,
        team,
        mode,
        status: 'running',
        startedAt: Date.now(),
        activeAgent: participantId(team.find((p) => p.role === 'coordinator') ?? team[0]),
        messages: [{ id: randomUUID(), author: promptAuthor, text: prompt, at: Date.now() }],
        events: [],
        approvals: [],
        artifacts: [],
        output: '',
      };
      run.conversationId = chat.id;
      runsById.set(run.id, run);
      if (legacy) legacyRunIds.add(run.id);
      currentRunId = run.id;
      chat.currentRunId = run.id;
      chat.draft = '';
      touch(run);
      try {
        beforePublish?.(run);
        persist(true);
      } catch (e) {
        run.status = 'cancelled';
        run.activeAgent = null;
        throw e;
      }
      if (res) json(res, 201, run);
      const id = run.id;
      void (async () => {
        const availability = runner ? await checkExecution() : undefined;
        if (closing || run.status === 'cancelled') return;
        if (!modelReady() || (config.workspaceToolsEnabled && !availability?.available)) {
          onEvent({
            runId: id,
            type: 'run_failed',
            at: new Date().toISOString(),
            message: config.workspaceToolsEnabled
              ? 'Live workspace mode needs an accessible local folder, an explicit model, and a server-side API key. Nothing has been sent to a model.'
              : 'Live chat needs an explicit model and a server-side API key. Nothing has been sent to a model.',
          });
          persist();
          return;
        }
        if (runner) await runner.snapshot(id);
        if (closing || (run.status as string) === 'cancelled') return;
        const current = (p: Persona) => withLibraryCapabilities(p, profiles);
        sync(
          await sdk.start({
            runId: id,
            prompt,
            team: team.map(current),
            history,
            availableBots:
              chat.availableBots?.map(current) ??
              (chat.participants.length === 1 &&
              chat.participants[0].role === 'coordinator' &&
              !chat.startedBy
                ? []
                : undefined),
          }),
        );
        persist();
      })().catch(() => {
        if (run.status !== 'cancelled')
          onEvent({
            runId: id,
            type: 'run_failed',
            at: new Date().toISOString(),
            message:
              'The run failed safely. Review local configuration before starting another run.',
          });
        persist();
      });
      return run;
    } catch (error) {
      if (previousRoster === undefined) delete chat.availableBots;
      else chat.availableBots = previousRoster;
      throw error;
    } finally {
      starting.delete(chat.id);
    }
  }
  /** The bot's own direct chat, as the Bot library's Talk button finds it; created if missing. */
  function directChat(bot: Persona): { chat: Conversation; created: boolean } {
    const existing = [...conversations.values()]
      .filter((c) => !c.startedBy && c.participants.length === 1 && c.participants[0].id === bot.id)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (existing) return { chat: existing, created: false };
    if (conversations.size >= CONVERSATION_LIMITS.conversations)
      throw new HttpError(409, 'Conversation limit reached.');
    const now = Date.now(),
      chat: Conversation = {
        id: randomUUID(),
        title: bot.name,
        participants: validateParticipants([bot]),
        createdAt: now,
        updatedAt: now,
        draft: '',
        currentRunId: null,
      };
    conversations.set(chat.id, chat);
    return { chat, created: true };
  }
  /**
   * Start every schedule that is due. A due time is marked handled before its run starts, so a
   * crash or restart cannot run it twice. The run goes through startRun like a typed message: the
   * same agents, budgets and capabilities, and an edit or command still waits for your approval.
   */
  function runDueSchedules() {
    if (!schedulesRun || closing) return;
    const now = clock();
    for (const schedule of schedules.list()) {
      const slot = dueSlot(schedule, now);
      if (slot === null) continue;
      try {
        schedules.markHandled(schedule.id, slot);
      } catch {
        continue; // Not recorded, so not run: a run that cannot be remembered could repeat.
      }
      let lastRun: NonNullable<typeof schedule.lastRun>;
      const bot = profiles.find((p) => p.id === schedule.botId);
      // A bot given edit or run after it was scheduled still runs; those tools wait for approval.
      if (schedule.lastRun && now - schedule.lastRun.at < SCHEDULE_LIMITS.minGapMs)
        lastRun = { at: now, skipped: 'Skipped: it already ran less than an hour ago.' };
      else if (!bot)
        lastRun = { at: now, skipped: 'Skipped: the bot is no longer in the library.' };
      else if (bot.role === 'coordinator')
        lastRun = { at: now, skipped: 'Skipped: schedules are for ordinary bots.' };
      else if (!modelReady())
        lastRun = {
          at: now,
          skipped: 'Skipped: live mode needs a model and a server-side API key. Nothing was sent.',
        };
      else {
        let target: ReturnType<typeof directChat> | undefined;
        try {
          target = directChat(bot);
          if (
            allRuns().some(
              (run) =>
                run.conversationId === target!.chat.id &&
                ['running', 'awaiting_approval'].includes(run.status),
            )
          )
            throw new HttpError(409, 'the bot’s chat was still busy with another run.');
          const run = startRun(schedule.prompt, target.chat, undefined, false, 'user', (run) => {
            run.scheduleId = schedule.id;
          });
          lastRun = { at: now, runId: run.id, conversationId: target.chat.id };
        } catch (error) {
          if (target?.created && !target.chat.currentRunId) conversations.delete(target.chat.id);
          lastRun = {
            at: now,
            skipped: `Skipped: ${error instanceof HttpError ? error.message : 'the run could not start.'}`,
          };
        }
      }
      try {
        schedules.markHandled(schedule.id, slot, lastRun);
      } catch {}
    }
  }
  async function createAgent(
    runId: string,
    request: { name: string; purpose: string; capabilities: Capability[] },
  ): Promise<Persona> {
    const run = findRun(runId),
      chat = run?.conversationId ? conversations.get(run.conversationId) : undefined;
    if (
      closing ||
      !run ||
      run.status !== 'running' ||
      !chat ||
      chat.startedBy ||
      chat.participants.length !== 1 ||
      chat.participants[0].role !== 'coordinator'
    )
      throw new Error('Only an active direct coordinator can create a bot.');
    if (Object.keys(request).some((key) => !['name', 'purpose', 'capabilities'].includes(key)))
      throw new Error('Only name, personality and capabilities are accepted.');
    // Capabilities are required here: a created bot never silently gets every tool.
    if (!Array.isArray(request.capabilities)) throw new Error('Choose capabilities.');
    const asked = validateParticipants([
      { ...request, role: 'agent', id: randomUUID(), ...randomAppearance() },
    ])[0];
    // The bot starts with what is safe to give unasked. The rest waits for the user's OK, which
    // they give from the creation message (or later in the Bot library).
    const { granted, needsUser } = splitCreatedCapabilities(asked.capabilities!);
    const candidate = validateParticipants([{ ...asked, capabilities: granted }])[0];
    const key = canonicalJson({
      name: candidate.name,
      purpose: candidate.purpose,
      role: candidate.role,
      capabilities: asked.capabilities,
    });
    const cache = createdAgents.get(runId) ?? new Map<string, Persona>();
    const previous = cache.get(key);
    if (previous) return previous;
    if (cache.size >= 3 || profiles.length >= 32 || (chat.availableBots?.length ?? 0) >= 32)
      throw new Error('Bot creation limit reached.');
    if (conversations.size >= CONVERSATION_LIMITS.conversations)
      throw new Error('Conversation limit reached.');
    const now = Date.now(),
      direct: Conversation = {
        id: randomUUID(),
        title: candidate.name,
        participants: [candidate],
        createdAt: now,
        updatedAt: now,
        draft: '',
        currentRunId: null,
      };
    conversations.set(direct.id, direct);
    const oldProfiles = profiles,
      oldRoster = chat.availableBots,
      oldUpdated = chat.updatedAt,
      oldImported = libraryImported;
    const messageId = randomUUID();
    libraryImported = true;
    profiles = validateProfiles([...profiles, candidate]);
    chat.availableBots = validateAvailableBots([...(chat.availableBots ?? []), candidate]);
    run.messages.push({
      id: messageId,
      author: 'coordinator',
      createdAgentId: candidate.id,
      ...(needsUser.length ? { requestedCapabilities: needsUser } : {}),
      conversationId: direct.id,
      text: `Created ${candidate.name}: ${candidate.purpose}`,
      kind: 'result',
      at: Date.now(),
    });
    touch(run);
    try {
      persist(true);
    } catch (error) {
      conversations.delete(direct.id);
      profiles = oldProfiles;
      libraryImported = oldImported;
      chat.availableBots = oldRoster;
      chat.updatedAt = oldUpdated;
      run.messages = run.messages.filter((m) => m.id !== messageId);
      throw error;
    }
    cache.set(key, candidate);
    createdAgents.set(runId, cache);
    return candidate;
  }
  async function messageAgent(
    runId: string,
    request: { agentId: string; message: string },
  ): Promise<{ conversationId: string; agentId: string }> {
    const sourceRun = findRun(runId),
      source = sourceRun?.conversationId ? conversations.get(sourceRun.conversationId) : undefined;
    if (
      closing ||
      !sourceRun ||
      sourceRun.status !== 'running' ||
      !source ||
      source.startedBy ||
      source.participants.length !== 1 ||
      source.participants[0].role !== 'coordinator'
    )
      throw new Error('Only an active direct coordinator can message an agent.');
    if (
      Object.keys(request).some((k) => !['agentId', 'message'].includes(k)) ||
      typeof request.agentId !== 'string' ||
      typeof request.message !== 'string' ||
      !request.message.trim() ||
      request.message.length > 8000
    )
      throw new Error('Choose an available agent and a message of 1–8,000 characters.');
    const agent = source.availableBots?.find((p) => p.id === request.agentId);
    if (!agent || agent.role === 'coordinator') throw new Error('Recipient is not available.');
    const brief = redactSdkText(request.message.trim()),
      key = canonicalJson({ agentId: agent.id, message: brief }),
      cache =
        sentMessages.get(runId) ?? new Map<string, { conversationId: string; agentId: string }>();
    const previous = cache.get(key);
    if (previous) return previous;
    if (cache.size >= 3) throw new Error('Message limit reached for this run.');
    let recipient = [...conversations.values()].find(
      (c) =>
        !c.startedBy &&
        c.participants.length === 1 &&
        canonicalJson(c.participants[0]) === canonicalJson(agent),
    );
    const created = !recipient;
    if (!recipient) {
      if (conversations.size >= CONVERSATION_LIMITS.conversations)
        throw new Error('Conversation limit reached.');
      const now = Date.now();
      recipient = {
        id: randomUUID(),
        title: agent.name,
        participants: validateParticipants([agent]),
        createdAt: now,
        updatedAt: now,
        draft: '',
        currentRunId: null,
      };
      conversations.set(recipient.id, recipient);
    }
    const oldRecipient = { ...recipient },
      oldCurrent = currentRunId,
      oldSourceUpdated = source.updatedAt;
    let child: Run | undefined, linkId: string | undefined;
    try {
      child = startRun(brief, recipient, undefined, false, 'coordinator', (run) => {
        recipient!.draft = oldRecipient.draft;
        child = run;
        run.sentBy = { conversationId: source.id, runId, coordinatorId: source.participants[0].id };
        linkId = randomUUID();
        sourceRun.messages.push({
          id: linkId,
          author: 'coordinator',
          text: `Sent a message to ${agent.name}.`,
          conversationId: recipient!.id,
          recipientRunId: run.id,
          kind: 'delegation',
          at: Date.now(),
        });
        touch(sourceRun);
      });
      const result = { conversationId: recipient.id, agentId: agent.id };
      cache.set(key, result);
      sentMessages.set(runId, cache);
      return result;
    } catch (error) {
      if (child) {
        child.status = 'cancelled';
        runner?.disposeRun(child.id);
        runsById.delete(child.id);
        traces.forget(child.id);
      }
      if (linkId) sourceRun.messages = sourceRun.messages.filter((m) => m.id !== linkId);
      source.updatedAt = oldSourceUpdated;
      if (created) conversations.delete(recipient.id);
      else Object.assign(recipient, oldRecipient);
      currentRunId = oldCurrent;
      persist();
      throw error;
    }
  }
  async function startGroup(
    runId: string,
    request: SdkStartGroupRequest,
  ): Promise<SdkStartedGroup> {
    if (closing) throw new Error('The server is shutting down.');
    const sourceRun = findRun(runId),
      source = sourceRun?.conversationId ? conversations.get(sourceRun.conversationId) : undefined;
    if (!sourceRun || !source) throw new Error('Source conversation not found.');
    const selected = selectCoordinatorGroup(source, sourceRun, request);
    const requestKey = canonicalJson(selected);
    const existing = [...conversations.values()].find((chat) => chat.startedBy?.runId === runId);
    if (existing) {
      if (groupRequests.get(runId) !== requestKey)
        throw new Error('This coordinator run already started a different group.');
      return { conversationId: existing.id, title: existing.title };
    }
    if (
      conversations.size >= CONVERSATION_LIMITS.conversations ||
      allRuns().length >= CONVERSATION_LIMITS.runs
    )
      throw new Error('Conversation or run limit reached.');
    // All validation and publication below are synchronous: cancellation cannot interleave a creation.
    const now = Date.now(),
      group: Conversation = {
        id: randomUUID(),
        title: selected.title,
        participants: selected.participants,
        createdAt: now,
        updatedAt: now,
        draft: '',
        currentRunId: null,
        startedBy: {
          conversationId: source.id,
          runId,
          coordinatorId: source.participants[0].id,
          brief: selected.brief,
        },
      };
    const previousCurrent = currentRunId;
    conversations.set(group.id, group);
    let child: Run | undefined, linkId: string | undefined;
    try {
      child = startRun(selected.brief, group, undefined, false, 'coordinator', (run) => {
        child = run;
        linkId = randomUUID();
        sourceRun.messages.push({
          id: linkId,
          author: 'coordinator',
          text: `Started ${group.title} with ${group.participants
            .slice(1)
            .map((p) => p.name)
            .join(', ')}.`,
          conversationId: group.id,
          kind: 'delegation',
          at: Date.now(),
        });
        touch(sourceRun);
      });
      // The child and source link have been persisted in the same atomic replacement.
      groupRequests.set(runId, requestKey);
      return { conversationId: group.id, title: group.title };
    } catch (error) {
      child ??= group.currentRunId ? findRun(group.currentRunId) : undefined;
      if (child) {
        child.status = 'cancelled';
        runner?.disposeRun(child.id);
        runsById.delete(child.id);
        traces.forget(child.id);
      }
      if (linkId)
        sourceRun.messages = sourceRun.messages.filter((message) => message.id !== linkId);
      conversations.delete(group.id);
      currentRunId = previousCurrent;
      persist();
      throw error;
    }
  }
  async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
    const method = req.method ?? 'GET';
    if (closing) throw new HttpError(503, 'The server is shutting down.');
    if (url.pathname === '/api/session' && method === 'GET') {
      security.check(req, false);
      json(res, 200, security.bootstrap(res));
      return;
    }
    security.check(req);
    if (url.pathname === '/api/state' && method === 'GET') {
      persist();
      json(res, 200, state());
      return;
    }
    const memoryRoute = /^\/api\/memories(?:\/([a-zA-Z0-9_-]+))?$/.exec(url.pathname);
    if (memoryRoute && ['GET', 'POST', 'DELETE'].includes(method)) {
      const body =
        method === 'GET' ? { agentId: url.searchParams.get('agentId') } : await readJson(req);
      if (Object.keys(body).some((key) => !['agentId', 'text'].includes(key)))
        throw new HttpError(400, 'Only a bot and memory text are accepted.');
      const agentId = body.agentId;
      if (
        typeof agentId !== 'string' ||
        (!profiles.some((p) => p.id === agentId) &&
          ![...conversations.values()].some((c) => c.participants.some((p) => p.id === agentId)))
      )
        throw new HttpError(404, 'Bot not found.');
      try {
        if (method === 'GET' && !memoryRoute[1]) json(res, 200, memory.list(agentId));
        else if (method === 'POST' && !memoryRoute[1]) {
          if (typeof body.text !== 'string') throw new HttpError(400, 'Enter a memory.');
          json(res, 201, memory.remember(agentId, body.text));
        } else if (method === 'DELETE' && memoryRoute[1]) {
          if (!memory.forget(agentId, memoryRoute[1]))
            throw new HttpError(404, 'Memory not found for this bot.');
          json(res, 200, { ok: true });
        } else throw new HttpError(400, 'Choose a valid memory action.');
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (error instanceof MemoryError)
          throw new HttpError(
            ['READ_FAILED', 'WRITE_FAILED'].includes(error.code)
              ? 503
              : error.code === 'CAPACITY'
                ? 409
                : 400,
            error.message,
          );
        throw new HttpError(503, 'Memory could not be updated. Existing memories were preserved.');
      }
      return;
    }
    if (url.pathname === '/api/profiles/import' && method === 'POST') {
      const body = await readJson(req);
      if (Object.keys(body).some((k) => k !== 'profiles'))
        throw new HttpError(400, 'Only profiles are accepted.');
      let incoming: Persona[];
      try {
        incoming = validateProfiles(body.profiles);
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
      if (
        !libraryImported &&
        incoming.some(
          (p) =>
            p.role !== 'coordinator' &&
            profiles.some((old) => old.id === p.id && old.role === 'coordinator'),
        )
      )
        throw new HttpError(400, 'An existing coordinator must keep its coordinator role.');
      // Saved libraries from before this rule may hold several primaries and keep loading; only
      // an import that would add another is refused.
      const newPrimaries = incoming.filter(
        (p) =>
          p.role === 'coordinator' &&
          !profiles.some((old) => old.id === p.id && old.role === 'coordinator'),
      );
      if (newPrimaries.length > 1 || (newPrimaries.length && profiles.some(isPrimary)))
        throw new HttpError(400, ONE_PRIMARY);
      const previous = profiles,
        previousImported = libraryImported;
      profiles = validateProfiles([
        ...new Map(
          (libraryImported ? [...incoming, ...profiles] : [...profiles, ...incoming]).map((p) => [
            p.id,
            p,
          ]),
        ).values(),
      ]);
      libraryImported = true;
      try {
        persist(true);
      } catch (e) {
        profiles = previous;
        libraryImported = previousImported;
        throw e;
      }
      json(res, 200, profiles);
      return;
    }
    const profileRoute = /^\/api\/profiles(?:\/([a-zA-Z0-9_-]+))?$/.exec(url.pathname);
    if (profileRoute && (method === 'POST' || method === 'DELETE')) {
      const id = profileRoute[1],
        existing = profiles.find((p) => p.id === id);
      if (id && !existing) throw new HttpError(404, 'Bot not found.');
      const previous = profiles,
        previousImported = libraryImported;
      let profile: Persona | undefined;
      if (method === 'DELETE') {
        if (!id) throw new HttpError(400, 'Choose a bot.');
        profiles = profiles.filter((p) => p.id !== id);
      } else {
        const body = await readJson(req);
        if (
          Object.keys(body).some(
            (k) => !['name', 'purpose', 'role', 'color', 'shape', 'capabilities'].includes(k),
          )
        )
          throw new HttpError(400, 'Only bot profile fields are accepted.');
        if (
          !existing &&
          body.role !== undefined &&
          !['agent', 'coordinator'].includes(String(body.role))
        )
          throw new HttpError(400, 'New profiles are ordinary agents or a primary coordinator.');
        profile = validateParticipants([
          {
            role: 'agent',
            ...randomAppearance(),
            ...(existing ?? {}),
            ...body,
            id: id ?? randomUUID(),
          },
        ])[0];
        if (existing?.role === 'coordinator' && profile.role !== 'coordinator')
          throw new HttpError(400, 'An existing coordinator must keep its coordinator role.');
        if (
          profile.role === 'coordinator' &&
          profiles.some((p) => isPrimary(p) && p.id !== profile!.id)
        )
          throw new HttpError(400, ONE_PRIMARY);
        profiles = validateProfiles(
          id ? profiles.map((p) => (p.id === id ? profile! : p)) : [...profiles, profile],
        );
      }
      libraryImported = true;
      try {
        persist(true);
      } catch (e) {
        profiles = previous;
        libraryImported = previousImported;
        throw e;
      }
      // A deleted bot's schedules and memory notes go with it. If that cannot be saved, its
      // schedules are skipped when due and its notes reach no one.
      if (method === 'DELETE') {
        try {
          schedules.removeForBot(id!);
        } catch {}
        try {
          memory.forgetAgent(id!);
        } catch {}
      }
      json(res, method === 'DELETE' ? 200 : id ? 200 : 201, profile ?? { ok: true });
      return;
    }
    const scheduleRoute = /^\/api\/schedules(?:\/([a-zA-Z0-9_-]+))?$/.exec(url.pathname);
    if (scheduleRoute && (method === 'POST' || method === 'DELETE')) {
      const id = scheduleRoute[1];
      try {
        if (method === 'DELETE') {
          if (!id || !schedules.remove(id)) throw new HttpError(404, 'Schedule not found.');
          json(res, 200, { ok: true });
          return;
        }
        const body = await readJson(req);
        if (!id) {
          const refusal = scheduleRefusal(profiles.find((p) => p.id === body.botId));
          if (refusal) throw new HttpError(refusal === 'Bot not found.' ? 404 : 400, refusal);
          json(res, 201, scheduleView(schedules.create(body, clock()), clock()));
        } else {
          const existing = schedules.get(id);
          if (!existing) throw new HttpError(404, 'Schedule not found.');
          // Resuming checks the bot again: its capabilities may have changed since.
          if (existing.paused && body.paused === false) {
            const refusal = scheduleRefusal(profiles.find((p) => p.id === existing.botId));
            if (refusal) throw new HttpError(400, refusal);
          }
          json(res, 200, scheduleView(schedules.update(id, body, clock()), clock()));
        }
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (error instanceof ScheduleError)
          throw new HttpError(
            error.code === 'NOT_FOUND'
              ? 404
              : error.code === 'CAPACITY'
                ? 409
                : error.code === 'INVALID'
                  ? 400
                  : 503,
            error.message,
          );
        throw new HttpError(503, 'Schedules could not be updated. Existing schedules were kept.');
      }
      return;
    }
    if (url.pathname === '/api/conversations' && method === 'POST') {
      const body = await readJson(req);
      if (
        Object.keys(body).some((key) => !['title', 'participants', 'availableBots'].includes(key))
      )
        throw new HttpError(
          400,
          'Only title, one participant, and an optional coordinator roster are accepted.',
        );
      let participants: Persona[];
      try {
        participants = validateParticipants(body.participants);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      if (participants.length !== 1)
        throw new HttpError(
          400,
          'Start a direct conversation. Only a coordinator can bring bots into a group.',
        );
      let availableBots: Persona[] | undefined;
      if (body.availableBots !== undefined) {
        if (participants[0].role !== 'coordinator')
          throw new HttpError(400, 'Only a direct coordinator can have an available-bot roster.');
        try {
          availableBots = validateAvailableBots(body.availableBots);
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
        if (availableBots.some((bot) => bot.id === participants[0].id))
          throw new HttpError(400, 'Coordinator and specialist IDs must differ.');
      }
      const title = validTitle(body.title ?? 'New chat');
      if (conversations.size >= CONVERSATION_LIMITS.conversations)
        throw new HttpError(409, 'Conversation limit reached. Existing history was preserved.');
      const now = Date.now(),
        chat: Conversation = {
          id: randomUUID(),
          title,
          participants,
          ...(availableBots ? { availableBots } : {}),
          createdAt: now,
          updatedAt: now,
          draft: '',
          currentRunId: null,
        };
      conversations.set(chat.id, chat);
      try {
        persist(true);
      } catch (e) {
        conversations.delete(chat.id);
        throw e;
      }
      json(res, 201, chat);
      return;
    }
    const conversationRoute = /^\/api\/conversations\/([a-zA-Z0-9_-]+)(?:\/(runs))?$/.exec(
      url.pathname,
    );
    // Deleting a chat removes its runs too. A group it started keeps working on its own.
    if (conversationRoute && !conversationRoute[2] && method === 'DELETE') {
      const chat = conversations.get(conversationRoute[1]);
      if (!chat) throw new HttpError(404, 'Conversation not found.');
      const runs = allRuns().filter((run) => run.conversationId === chat.id);
      if (
        starting.has(chat.id) ||
        runs.some((run) => ['running', 'awaiting_approval'].includes(run.status))
      )
        throw new HttpError(409, 'Stop this conversation’s task before deleting it.');
      conversations.delete(chat.id);
      for (const run of runs) runsById.delete(run.id);
      try {
        persist(true);
      } catch (e) {
        conversations.set(chat.id, chat);
        for (const run of runs) runsById.set(run.id, run);
        throw e;
      }
      for (const run of runs) {
        traces.forget(run.id);
        legacyRunIds.delete(run.id);
        if (currentRunId === run.id) currentRunId = null;
      }
      json(res, 200, { ok: true });
      return;
    }
    if (conversationRoute && method === 'POST') {
      const chat = conversations.get(conversationRoute[1]);
      if (!chat) throw new HttpError(404, 'Conversation not found.');
      const body = await readJson(req);
      if (conversationRoute[2]) {
        if (Object.keys(body).some((key) => key !== 'prompt'))
          throw new HttpError(
            400,
            'Only a prompt is accepted; participants belong to this conversation.',
          );
        await startRun(body.prompt, chat, res);
        return;
      }
      if (Object.keys(body).some((key) => !['title', 'draft', 'availableBots'].includes(key)))
        throw new HttpError(
          400,
          'Only title, draft, and an initial coordinator roster can be updated.',
        );
      const title = body.title === undefined ? chat.title : validTitle(body.title);
      if (body.draft !== undefined && (typeof body.draft !== 'string' || body.draft.length > 8000))
        throw new HttpError(400, 'Drafts allow up to 8,000 characters.');
      let availableBots = chat.availableBots;
      if (body.availableBots !== undefined) {
        if (
          chat.participants.length !== 1 ||
          chat.participants[0].role !== 'coordinator' ||
          chat.startedBy
        )
          throw new HttpError(400, 'Only a direct coordinator can have an available-bot roster.');
        if (
          starting.has(chat.id) ||
          allRuns().some(
            (run) =>
              run.conversationId === chat.id &&
              ['running', 'awaiting_approval'].includes(run.status),
          )
        )
          throw new HttpError(
            409,
            'Finish or stop this conversation before initializing its roster.',
          );
        try {
          availableBots = validateAvailableBots(body.availableBots);
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
        if (availableBots.some((bot) => bot.id === chat.participants[0].id))
          throw new HttpError(400, 'Coordinator and specialist IDs must differ.');
        if (
          chat.availableBots !== undefined &&
          canonicalJson(chat.availableBots) !== canonicalJson(availableBots)
        )
          throw new HttpError(
            409,
            'This conversation’s roster is already saved. Start a new conversation to choose a different roster.',
          );
      }
      const previous = { ...chat };
      chat.title = title;
      if (typeof body.draft === 'string') chat.draft = redactSdkText(body.draft);
      if (availableBots !== undefined) chat.availableBots = availableBots;
      chat.updatedAt = Date.now();
      try {
        persist(true);
      } catch (e) {
        Object.assign(chat, previous);
        if (previous.availableBots === undefined) delete chat.availableBots;
        throw e;
      }
      json(res, 200, chat);
      return;
    }
    if (url.pathname === '/api/runs' && method === 'POST') {
      // Compatibility route: a legacy request receives its own chat, never another chat's context.
      const body = await readJson(req);
      let team: Persona[];
      try {
        team =
          body.team === undefined
            ? defaultParticipants().slice(0, 1)
            : validateParticipants(body.team);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      if (team.length !== 1)
        throw new HttpError(
          400,
          'Only a coordinator can create a group; legacy starts also require one bot.',
        );
      if (
        starting.has('legacy') ||
        [...legacyRunIds].some((id) => {
          const run = findRun(id);
          return run && ['running', 'awaiting_approval'].includes(run.status);
        })
      )
        throw new HttpError(409, 'Finish or stop the current legacy run before starting another.');
      if (conversations.size >= CONVERSATION_LIMITS.conversations)
        throw new HttpError(409, 'Conversation limit reached.');
      const now = Date.now(),
        chat: Conversation = {
          id: randomUUID(),
          title:
            typeof body.prompt === 'string'
              ? redactSdkText(body.prompt.trim()).slice(0, 80) || 'New chat'
              : 'New chat',
          participants: team,
          createdAt: now,
          updatedAt: now,
          draft: '',
          currentRunId: null,
        };
      starting.add('legacy');
      conversations.set(chat.id, chat);
      try {
        await startRun(body.prompt, chat, res, true);
      } catch (e) {
        if (!chat.currentRunId) conversations.delete(chat.id);
        throw e;
      } finally {
        starting.delete('legacy');
      }
      return;
    }
    const traceRoute =
      /^\/api\/conversations\/([a-zA-Z0-9_-]+)\/runs\/([a-zA-Z0-9_-]+)\/trace$/.exec(url.pathname);
    if (traceRoute && method === 'GET') {
      const run = findRun(traceRoute[2]);
      if (!run || run.conversationId !== traceRoute[1] || !conversations.has(traceRoute[1]))
        throw new HttpError(404, 'Run not found in this conversation.');
      json(
        res,
        200,
        traces.get(run.id) ?? { runId: run.id, available: false, calls: [], truncated: false },
      );
      return;
    }
    const scoped =
      /^\/api\/conversations\/([a-zA-Z0-9_-]+)\/runs\/([a-zA-Z0-9_-]+)\/(approval|stop)$/.exec(
        url.pathname,
      );
    const legacy = /^\/api\/runs\/([a-zA-Z0-9_-]+)\/(approval|stop)$/.exec(url.pathname);
    if ((scoped || legacy) && method === 'POST') {
      const id = scoped ? scoped[2] : legacy![1],
        operation = scoped ? scoped[3] : legacy![2];
      const run = findRun(id);
      if (
        !run ||
        (scoped
          ? run.conversationId !== scoped[1] || !conversations.has(scoped[1])
          : !legacyRunIds.has(id))
      )
        throw new HttpError(404, 'Run not found in this conversation.');
      const body = await readJson(req);
      if (operation === 'stop') {
        await sdk.cancel(id);
        runner?.disposeRun(id);
        if (['running', 'awaiting_approval'].includes(run.status))
          onEvent({
            runId: id,
            type: 'run_cancelled',
            at: new Date().toISOString(),
            message: 'Stopped. Pending approvals are invalid.',
          });
        touch(run);
        persist(true);
        json(res, 200, { ok: true });
        return;
      }
      if (!config.workspaceToolsEnabled)
        throw new HttpError(409, 'Workspace approvals are unavailable in chat-only mode.');
      const { approvalId, digest, approved } = body;
      if (
        typeof approvalId !== 'string' ||
        typeof digest !== 'string' ||
        typeof approved !== 'boolean'
      )
        throw new HttpError(
          400,
          'An exact approval ID, digest, and explicit decision are required.',
        );
      const pending = run.approvals.find((a) => a.id === approvalId && a.status === 'pending');
      if (!pending || pending.digest !== digest || run.status !== 'awaiting_approval')
        throw new HttpError(409, 'This approval is stale, changed, or already used.');
      pending.status = approved ? 'approved' : 'denied';
      pending.decidedAt = Date.now();
      run.status = 'running';
      touch(run);
      persist(true);
      json(res, 202, { ok: true });
      void sdk
        .resume({ runId: id, approvalId, digest, approved })
        .then((s) => {
          sync(s);
          persist();
        })
        .catch(() => {
          onEvent({
            runId: id,
            type: 'run_failed',
            at: new Date().toISOString(),
            message:
              'That approval could not be resumed. Start a new run; the old approval cannot be reused.',
          });
          persist();
        });
      return;
    }
    throw new HttpError(404, 'Endpoint not found.');
  }
  const server = createServer(async (req, res) => {
    security.headers(res, !!options.production);
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${options.port}`);
      security.check(req, false, url.pathname === '/');
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else if (options.serve) await options.serve(req, res);
      else throw new HttpError(404, 'Asset not found.');
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      json(res, e instanceof HttpError ? e.status : 400, {
        error: e instanceof HttpError ? e.message : 'The request could not be completed safely.',
      });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  persist(true);
  if (runner) void checkExecution();
  const saveTimer = setInterval(() => persist(), 250);
  saveTimer.unref();
  // A schedule that came due while the server was off runs now, once.
  runDueSchedules();
  const scheduleTimer = setInterval(runDueSchedules, SCHEDULE_LIMITS.checkMs);
  scheduleTimer.unref();
  return {
    server,
    state,
    /** Check for due schedules now, instead of waiting for the next half-minute check. */
    runDueSchedules,
    async close() {
      closing = true;
      clearInterval(saveTimer);
      clearInterval(scheduleTimer);
      for (const run of runsById.values())
        if (['running', 'awaiting_approval'].includes(run.status)) {
          run.status = 'cancelled';
          run.activeAgent = null;
          run.endedAt = Date.now();
          for (const approval of run.approvals)
            if (approval.status === 'pending') {
              approval.status = 'denied';
              approval.decidedAt = run.endedAt;
            }
          touch(run);
        }
      try {
        await Promise.all([...runsById.keys()].map((id) => sdk.cancel(id)));
        for (const id of runsById.keys()) runner?.disposeRun(id);
        const cleanup = runner ? await runner.shutdown() : { cleanupSucceeded: true };
        persist(true);
        return cleanup;
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        if (demoWorkspace) rmSync(demoWorkspace, { recursive: true, force: true });
      }
    },
  };
}
