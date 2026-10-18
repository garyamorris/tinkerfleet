import { validateParticipants, validateAvailableBots } from './personas.js';
import { randomUUID, createHash } from 'node:crypto';
import type { Persona, Run, AgentId, Action, FleetEvent } from '../shared/types.js';
import { initialSource, fixedSource } from '../shared/types.js';

type GroupRequest = { title: string; brief: string; botIds: string[] };
type MessageRequest = { agentId: string; message: string };
const workRequest = (prompt: string) =>
  !/^(?:hello|hi|hey|explain|teach|tell me|what|how)\b/i.test(prompt.trim()) &&
  /\b(fix|repair|build|implement|debug|run|verify|check|test)\b/i.test(prompt);

/** Deterministic, participant-aware lessons. Never calls a model or a command. */
export class DemoEngine {
  readonly runs = new Map<string, Run>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(
    private delayMs = 650,
    private startGroup?: (
      runId: string,
      request: GroupRequest,
    ) => Promise<{ conversationId: string; title: string }>,
    private createAgent?: (
      runId: string,
      request: { name: string; purpose: string },
    ) => Promise<Persona>,
    private messageAgent?: (
      runId: string,
      request: MessageRequest,
    ) => Promise<{ conversationId: string; agentId: string }>,
  ) {}

  start(
    prompt: string,
    team?: Persona[],
    options: { availableBots?: Persona[]; promptAuthor?: AgentId | 'user' } = {},
  ): Run {
    const runTeam = team === undefined ? undefined : validateParticipants(team);
    const availableBots =
      options.availableBots === undefined
        ? undefined
        : validateAvailableBots(options.availableBots);
    const run: Run = {
      ...(runTeam ? { team: runTeam } : {}),
      id: randomUUID(),
      prompt,
      status: 'running',
      mode: 'demo',
      messages: [],
      events: [],
      approvals: [],
      artifacts: [],
      output: '',
      activeAgent: null,
      startedAt: Date.now(),
    };
    this.runs.set(run.id, run);
    this.message(run, options.promptAuthor ?? 'user', prompt);
    if (runTeam?.length === 1 && runTeam[0].role === 'coordinator') {
      run.activeAgent = 'coordinator';
      this.message(
        run,
        'coordinator',
        'I’m your primary agent. We can work here, create reusable agents, or bring selected agents into a conversation. This no-key demo is scripted.',
      );
      this.later(run, () => {
        void this.coordinate(run, availableBots ?? []);
      });
    } else if (runTeam && !workRequest(prompt)) {
      this.later(run, () => this.greet(run));
    } else {
      this.message(
        run,
        this.speaker(run),
        `This scripted walkthrough uses ${this.identities(run)
          .map((id) => this.name(run, id))
          .join(
            ', ',
          )}. Agents share the same capabilities; this example assigns working steps by agent order while the primary coordinates. Every proposed edit and command needs your approval.`,
      );
      this.later(run, () => this.inspect(run));
    }
    return run;
  }

  /** Small documented examples, not general language understanding or model decisions. */
  private async coordinate(run: Run, availableBots: Persona[]) {
    const ask = /^ask\s+([^:\r\n]{1,64}):\s*([\s\S]+)$/i.exec(run.prompt.trim());
    if (ask) {
      const target = ask[1].trim().toLowerCase(),
        message = ask[2].trim();
      const matches = availableBots.filter(
        (bot) => bot.id.toLowerCase() === target || bot.name.toLowerCase() === target,
      );
      if (matches.length !== 1 || !this.messageAgent || message.length > 8000) {
        this.complete(
          run,
          'I could not send that scripted request. Use “Ask Ada: <message>” with one uniquely named agent in your library. No message was sent.',
        );
        return;
      }
      try {
        const result = await this.messageAgent(run.id, { agentId: matches[0].id, message });
        if (run.status !== 'running') return;
        if (result.agentId !== matches[0].id || !result.conversationId)
          throw new Error('Invalid message result.');
        this.complete(
          run,
          `Sent your message to ${matches[0].name} in their conversation. This is a scripted handoff; their reply will appear when their demo turn finishes.`,
          'Agent message sent',
        );
      } catch {
        this.fail(
          run,
          'I could not send that agent message. No successful handoff was confirmed.',
          'Agent message could not be sent',
        );
      }
      return;
    }
    const creation =
      /^(?:please\s+)?(?:create|make|add)\s+(?:me\s+)?(.{1,400}?)\s+(?:called|named)\s+([A-Za-z][A-Za-z0-9 -]{0,39}?)[.!]?$/i.exec(
        run.prompt.trim(),
      );
    if (creation && this.createAgent) {
      try {
        const persona = await this.createAgent(run.id, {
          name: creation[2].trim(),
          purpose: `Act as ${creation[1].trim()}.`,
        });
        if (run.status !== 'running') return;
        this.complete(
          run,
          `This scripted example saved ${persona.name} to your agent library. Try “Ask ${persona.name}: Hello”. You can also talk to them directly or include them in a group. Their personality guides live replies; the no-key demo remains scripted.`,
          'Agent saved to your library',
        );
      } catch {
        this.fail(
          run,
          'I could not save that agent. Check the agent library and workspace status before trying again.',
          'Agent could not be saved',
        );
      }
      return;
    }
    const asksForGroup =
      workRequest(run.prompt) || /\b(collaborate|team|group)\b/i.test(run.prompt);
    const staysDirect =
      /\b(?:do not|don't|without|no)\b[^.!?]{0,45}\b(?:group|team|agents?|specialists?|collaborat\w*)\b/i.test(
        run.prompt,
      );
    const selected = availableBots.slice(0, 3);
    if (asksForGroup && !staysDirect && selected.length && this.startGroup) {
      this.message(
        run,
        'coordinator',
        `For this scripted example, I’ll bring ${selected.map((p) => p.name).join(', ')} together to investigate tiny-project. I’ll share only a task brief.`,
        'delegation',
      );
      try {
        await this.startGroup(run.id, {
          title: 'Tiny-project repair',
          brief:
            'Fix the failing addition tests in tiny-project. Inspect the fixture, propose the smallest fix, and verify it. Ask for approval before any edit or command.',
          botIds: selected.map((p) => p.id),
        });
        if (run.status !== 'running') return;
        this.complete(
          run,
          'The shared conversation has started. Its scripted edits and commands still require your approval.',
          'Started a shared conversation',
        );
      } catch {
        this.fail(
          run,
          'I could not start that shared conversation. No edit or command was approved here.',
          'Shared conversation could not start',
        );
      }
    } else if (workRequest(run.prompt)) {
      this.inspect(run);
    } else this.greet(run);
  }

  private identities(run: Run): AgentId[] {
    return (
      run.team?.map((p) => (p.role === 'coordinator' ? 'coordinator' : p.id)) ?? [
        'scout',
        'maker',
        'checker',
      ]
    );
  }
  private speaker(run: Run): AgentId {
    return run.team?.some((p) => p.role === 'coordinator')
      ? 'coordinator'
      : this.identities(run)[0];
  }
  private stages(run: Run) {
    const selected = this.identities(run),
      ordinary = selected.filter((id) => id !== 'coordinator'),
      ids = ordinary.length ? ordinary : selected;
    return { inspect: ids[0], edit: ids[1] ?? ids[0], check: ids[2] ?? ids.at(-1)! };
  }
  private name(run: Run, id: AgentId) {
    return (
      run.team?.find((p) => (p.role === 'coordinator' ? 'coordinator' : p.id) === id)?.name ??
      id[0].toUpperCase() + id.slice(1)
    );
  }
  private later(run: Run, fn: () => void) {
    const timer = setTimeout(() => {
      this.timers.delete(run.id);
      if (run.status === 'running') fn();
    }, this.delayMs);
    this.timers.set(run.id, timer);
  }
  private message(
    run: Run,
    author: AgentId | 'user',
    text: string,
    kind: 'text' | 'delegation' | 'result' = 'text',
  ) {
    run.messages.push({ id: randomUUID(), author, text, kind, at: Date.now() });
  }
  private event(
    run: Run,
    agent: AgentId,
    kind: FleetEvent['kind'],
    title: string,
    detail?: string,
  ) {
    run.events.push({ id: randomUUID(), agent, kind, title, detail, at: Date.now() });
  }
  private complete(run: Run, text: string, title = 'Scripted response complete') {
    if (run.status !== 'running') return;
    this.message(run, this.speaker(run), text, 'result');
    run.status = 'completed';
    run.activeAgent = null;
    run.endedAt = Date.now();
    this.event(
      run,
      this.speaker(run),
      'result',
      title,
      'Scripted demo · no model call or local command',
    );
  }
  private fail(run: Run, text: string, title: string) {
    if (run.status !== 'running') return;
    run.status = 'failed';
    run.activeAgent = null;
    run.endedAt = Date.now();
    this.message(run, this.speaker(run), text);
    this.event(run, this.speaker(run), 'error', title, 'The scripted request failed.');
  }
  private greet(run: Run) {
    this.complete(
      run,
      `Hello from ${this.name(run, this.speaker(run))}. This no-key reply is scripted. Ask me to fix tiny-project to see file creation, editing, and commands simulated with approvals. Agents have the same tools; personality guides their live replies.`,
    );
  }
  private beginStage(run: Run, agent: AgentId, title: string) {
    run.activeAgent = agent;
    this.event(run, agent, 'message', title, 'Selected participant · scripted demo');
  }
  private inspect(run: Run) {
    const agent = this.stages(run).inspect;
    this.beginStage(run, agent, `${this.name(run, agent)}, take a look`);
    this.event(run, agent, 'tool', 'Read sum.js', 'Simulated read · 3 lines · tiny-project');
    this.message(
      run,
      agent,
      'Found it. sum() subtracts b from a. The tests expect addition, so one operator needs to change. No files have been edited.',
    );
    this.later(run, () => this.propose(run));
  }
  private propose(run: Run) {
    const agent = this.stages(run).edit;
    this.beginStage(run, agent, `${this.name(run, agent)}, propose the fix`);
    this.message(
      run,
      agent,
      'A one-character fix should do it. Here is the simulated change; your real project stays untouched.',
    );
    this.request(
      run,
      { kind: 'edit', path: 'sum.js', content: fixedSource },
      agent,
      'Update sum.js',
      'Change subtraction to addition. Original files stay untouched.',
      initialSource,
    );
  }
  private verify(run: Run) {
    const agent = this.stages(run).check;
    this.beginStage(run, agent, `${this.name(run, agent)}, verify the change`);
    this.message(
      run,
      agent,
      'I’ll show the project’s three test results in the simulation. No command runs on your computer in this demo.',
    );
    this.request(
      run,
      { kind: 'command', executable: 'node', args: ['--test', 'sum.test.js'], cwd: '.' },
      agent,
      'Run the test suite',
      'One simulated command. No host command executes.',
    );
  }
  private request(
    run: Run,
    action: Action,
    agent: AgentId,
    title: string,
    description: string,
    before?: string,
  ) {
    const id = randomUUID(),
      digest = createHash('sha256')
        .update(JSON.stringify({ runId: run.id, id, action }))
        .digest('hex');
    run.approvals.push({
      id,
      digest,
      agent,
      title,
      description,
      action,
      status: 'pending',
      before,
    });
    run.status = 'awaiting_approval';
    this.event(run, agent, 'approval', 'Your approval is needed', title);
  }
  private finish(run: Run) {
    const stages = this.stages(run);
    this.complete(
      run,
      `${this.name(run, stages.inspect)} inspected the fixture, ${this.name(run, stages.edit)} proposed the fix, and ${this.name(run, stages.check)} checked the expected result. Both approvals applied only to this simulation. The diff and simulated output are in Details; no real file changed.`,
    );
  }
  decide(runId: string, id: string, digest: string, approved: boolean): Run {
    const run = this.runs.get(runId);
    if (!run) throw new Error('Run not found or expired after restart.');
    const approval = run.approvals.find((a) => a.id === id);
    if (
      run.status !== 'awaiting_approval' ||
      !approval ||
      approval.status !== 'pending' ||
      approval.digest !== digest
    )
      throw new Error('This approval is stale, changed, or already used.');
    approval.status = approved ? 'approved' : 'denied';
    if (!approved) {
      run.status = 'denied';
      run.activeAgent = null;
      run.endedAt = Date.now();
      this.event(run, approval.agent, 'result', 'Action declined', 'No action was performed.');
      this.message(
        run,
        this.speaker(run),
        'Understood. I’ve stopped here. That action wasn’t performed, and your original project is unchanged.',
      );
      return run;
    }
    run.status = 'running';
    this.event(
      run,
      approval.agent,
      'result',
      'Approved for this action only',
      `Action fingerprint ${digest.slice(0, 12)} · consumed once`,
    );
    if (approval.action.kind === 'edit') {
      run.artifacts.push({
        path: 'sum.js',
        before: initialSource,
        after: fixedSource,
        simulated: true,
      });
      this.event(
        run,
        approval.agent,
        'result',
        'Simulated patch applied',
        'In-memory demo fixture only',
      );
      this.message(
        run,
        approval.agent,
        'The demo patch is ready in this run’s fixture. No real file was written.',
      );
      this.later(run, () => this.verify(run));
    } else {
      run.activeAgent = approval.agent;
      this.event(
        run,
        approval.agent,
        'tool',
        'Simulating node --test sum.test.js',
        'No command is running on this computer',
      );
      this.later(run, () => {
        run.output =
          '[SIMULATED DEMO OUTPUT]\n$ node --test sum.test.js\n\n✔ adds two positive numbers\n✔ handles negative numbers\n✔ adds zero\n\ntests 3   pass 3   fail 0\nexit code 0\n';
        this.event(
          run,
          approval.agent,
          'result',
          '3 of 3 tests pass · simulated',
          'Expected fixture output; not a real command run',
        );
        this.message(
          run,
          approval.agent,
          'All three fixture tests pass in the simulation. The patch is one line, and no real files changed.',
        );
        this.finish(run);
      });
    }
    return run;
  }
  cancel(id: string) {
    const run = this.runs.get(id);
    if (!run) throw new Error('Run not found.');
    if (!['running', 'awaiting_approval'].includes(run.status)) return run;
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    run.approvals.filter((a) => a.status === 'pending').forEach((a) => (a.status = 'denied'));
    run.status = 'cancelled';
    run.activeAgent = null;
    run.endedAt = Date.now();
    this.event(
      run,
      this.speaker(run),
      'result',
      'Run stopped',
      'Outstanding approvals invalidated',
    );
    this.message(
      run,
      this.speaker(run),
      'Stopped. Any pending approvals are now invalid. Start a new run whenever you’re ready.',
    );
    return run;
  }
  dispose() {
    for (const id of this.runs.keys()) this.cancel(id);
    this.runs.clear();
  }
}
