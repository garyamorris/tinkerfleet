/**
 * Build one run's agents with the tools that run may use: memory, workspace,
 * and (for a private primary agent) coordination tools. Each tool is a small
 * function with a schema; the SDK calls it when the model asks.
 */
import { tool, type Model, type Tool } from '@openai/agents';
import { z } from 'zod';
import type { AgentId, MemoryEntry, Persona } from '../../shared/types.js';
import { createdAgentProblem, normalizeCapabilities } from '../../shared/capabilities.js';
import { validateAvailableBots, validateParticipants } from '../personas.js';
import { requireSafeText } from './actions.js';
import type { SdkAdapterOptions, SdkEvent, SdkLimits, SdkReasoningEffort } from './contract.js';
import { SafeSdkError } from './errors.js';
import { createFleetAgents, defaultParticipants } from './fleet.js';
import { remapSources } from './response-sources.js';
import { assertActive, clone, type PrivateRun } from './run-state.js';
import {
  commandSchema,
  createAgentSchema,
  editSchema,
  groupSchema,
  memoryEntrySchema,
  memoryTextSchema,
  messageAgentSchema,
} from './schemas.js';

export interface RunFleetContext {
  options: SdkAdapterOptions;
  workspaceToolsEnabled: boolean;
  webSearchEnabled: boolean;
  reasoningEffort?: SdkReasoningEffort;
  limits: SdkLimits;
  boundedText: (value: unknown) => string;
  emit: (run: PrivateRun, event: Omit<SdkEvent, 'runId' | 'at'>) => void;
  runApproved: (run: PrivateRun, callId: string | undefined) => Promise<string>;
  modelForRun: (run: PrivateRun, role?: AgentId) => Model;
}

export async function buildRunFleet(run: PrivateRun, context: RunFleetContext) {
  const {
    options,
    workspaceToolsEnabled,
    webSearchEnabled,
    reasoningEffort,
    limits,
    boundedText,
    emit,
    runApproved,
    modelForRun,
  } = context;
  const memories = new Map<string, MemoryEntry[]>();
  const validateMemories = (input: unknown, owner: string): MemoryEntry[] => {
    if (!Array.isArray(input) || input.length > 20)
      throw new SafeSdkError(
        'Saved memory exceeds the per-bot entry limit. Review this bot’s memories locally.',
      );
    const ids = new Set<string>();
    let total = 0;
    return input.map((value) => {
      const parsed = memoryEntrySchema.safeParse(value);
      if (
        !parsed.success ||
        parsed.data.agentId !== owner ||
        ids.has(parsed.data.id) ||
        parsed.data.updatedAt < parsed.data.createdAt
      )
        throw new SafeSdkError(
          'Saved memory metadata was invalid for this bot. No foreign memories were loaded.',
        );
      const entry = parsed.data;
      requireSafeText(entry.text);
      ids.add(entry.id);
      total += entry.text.length;
      if (total > 8_000)
        throw new SafeSdkError(
          'Saved memory exceeds the per-bot text limit. Review this bot’s memories locally.',
        );
      return Object.freeze({ ...entry });
    });
  };
  const readMemory = async (owner: string) => {
    assertActive(run);
    let result: MemoryEntry[];
    try {
      result = await options.memory!.list(owner);
    } catch {
      throw new SafeSdkError(
        'This bot’s saved memory could not be loaded. Review the local memory store and try again.',
      );
    }
    assertActive(run);
    return validateMemories(result, owner);
  };
  if (options.memory)
    for (const profile of run.team ?? defaultParticipants())
      memories.set(profile.id, await readMemory(profile.id));
  const memoryTools = options.memory
    ? (profile: Persona): Tool[] => [
        tool({
          name: 'recall_memory',
          description: 'Read only this bot’s saved memories across its conversations.',
          parameters: z.object({}).strict(),
          errorFunction: null,
          execute: async () => boundedText(await readMemory(profile.id)),
        }),
        tool({
          name: 'remember_memory',
          description:
            'Save a bounded durable fact or preference in this bot’s own memory. Never store credentials.',
          parameters: z.object({ text: memoryTextSchema }).strict(),
          errorFunction: null,
          execute: async ({ text: rawText }) => {
            const text = rawText.replace(/\r\n?/g, '\n').trim();
            assertActive(run);
            requireSafeText(text);
            let result: MemoryEntry;
            try {
              result = await options.memory!.remember(profile.id, text);
            } catch {
              throw new SafeSdkError(
                'The memory could not be saved. Review this bot’s memory limits or local storage and try again.',
              );
            }
            assertActive(run);
            const entry = validateMemories([result], profile.id)[0];
            if (entry.text !== text)
              throw new SafeSdkError('The saved memory does not match the requested text.');
            return boundedText(entry);
          },
        }),
        tool({
          name: 'forget_memory',
          description:
            'Remove a saved entry from this bot’s own memory using its recalled entry ID.',
          parameters: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }).strict(),
          errorFunction: null,
          execute: async ({ id }) => {
            assertActive(run);
            let removed: boolean;
            try {
              removed = await options.memory!.forget(profile.id, id);
            } catch {
              throw new SafeSdkError(
                'The memory could not be removed. Review this bot’s local memory store and try again.',
              );
            }
            assertActive(run);
            if (typeof removed !== 'boolean')
              throw new SafeSdkError('The memory removal result was invalid.');
            return boundedText({ id, removed });
          },
        }),
      ]
    : undefined;
  const readTools = workspaceToolsEnabled
    ? [
        tool({
          name: 'list_files',
          description: 'List permitted files in the selected local workspace.',
          parameters: z.object({}).strict(),
          execute: async () => {
            assertActive(run);
            return boundedText(await options.harness.snapshot(run.view.runId));
          },
          errorFunction: () => 'Workspace listing was blocked or unavailable.',
        }),
        tool({
          name: 'read_file',
          description: 'Read a permitted text file from the selected local workspace.',
          parameters: z.object({ path: z.string().max(512) }).strict(),
          execute: async ({ path }) => {
            assertActive(run);
            return boundedText(await options.harness.readFile(run.view.runId, path));
          },
          errorFunction: () => 'File access was blocked or unavailable.',
        }),
      ]
    : [];
  const commandTools = workspaceToolsEnabled
    ? [
        tool({
          name: 'run_command',
          description:
            'Request an installed host command with separate executable and argv, without an implicit shell. It runs from the selected local workspace with host-user permissions, has real effects, and always pauses for human approval.',
          parameters: commandSchema,
          needsApproval: true,
          errorFunction: null,
          // needsApproval pauses the run. This only executes after the user approves,
          // and runs the stored copy of the approved action, not these arguments.
          execute: async (_args, _context, details) => runApproved(run, details?.toolCall?.callId),
        }),
      ]
    : [];
  const mutationTools = workspaceToolsEnabled
    ? [
        tool({
          name: 'edit_file',
          description:
            'Request a complete text file edit in the selected local workspace. The edit has real effects and always pauses for human approval.',
          parameters: editSchema,
          needsApproval: true,
          errorFunction: null,
          execute: async (_args, _context, details) => runApproved(run, details?.toolCall?.callId),
        }),
      ]
    : [];
  const privateCoordinator =
    run.team?.length === 1 && run.team[0].role === 'coordinator' && run.availableBots !== undefined;
  const canStartGroup = privateCoordinator && options.startGroup !== undefined;
  const groupTool = canStartGroup
    ? tool({
        name: 'start_group_conversation',
        description:
          'Create and start a separate shared conversation with one to seven registered agents. Choose unique IDs from the available roster. Does not bypass approvals for workspace actions.',
        parameters: groupSchema,
        errorFunction: null,
        execute: async (input) => {
          assertActive(run);
          const request = groupSchema.parse(input);
          requireSafeText(JSON.stringify(request));
          const selected = request.botIds.map((id) =>
            run.availableBots!.find((bot) => bot.id === id),
          );
          if (
            new Set(request.botIds).size !== request.botIds.length ||
            selected.some((bot) => !bot)
          ) {
            throw new SafeSdkError('Choose registered agents with unique IDs.');
          }
          const requestKey = JSON.stringify(request);
          if (run.createdGroup) {
            if (run.createdGroup.request !== requestKey)
              throw new SafeSdkError('Only one group can be started per user turn.');
            return boundedText(run.createdGroup.result);
          }
          // This server callback must also check the parent remains active before
          // committing creation; cancellation cannot undo a group already created.
          const result = await options.startGroup!(run.view.runId, clone(request));
          assertActive(run);
          if (
            !result ||
            typeof result.conversationId !== 'string' ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(result.conversationId) ||
            typeof result.title !== 'string' ||
            !result.title.trim() ||
            result.title.length > 80
          ) {
            throw new SafeSdkError('The created group metadata was invalid.');
          }
          requireSafeText(result.title);
          const metadata = { conversationId: result.conversationId, title: result.title };
          run.createdGroup = { request: requestKey, result: metadata };
          return boundedText(metadata);
        },
      })
    : undefined;
  const createAgentTool =
    privateCoordinator && options.createAgent
      ? tool({
          name: 'create_agent',
          description:
            'Create a reusable agent profile with a chosen name, personality, focus, and capabilities (tool groups). Choose the fewest capabilities the work needs: web, read, or memory; never edit or run, and not read with web. Returns the actual new bot identity for this conversation’s roster and future use, or why it was not created; does not execute work.',
          parameters: createAgentSchema,
          errorFunction: null,
          execute: async (input) => {
            assertActive(run);
            const request = createAgentSchema.parse(input);
            requireSafeText(JSON.stringify(request));
            const requestKey = JSON.stringify(request);
            const existing = run.createdAgents.get(requestKey);
            if (existing) return boundedText(existing);
            // The model may ask for any capability, but the server decides. A refusal is a normal
            // result, so the model can try again with fewer capabilities.
            const problem = createdAgentProblem(request.capabilities);
            if (problem) return boundedText({ created: false, reason: problem });
            if (run.createdAgents.size >= 3)
              throw new SafeSdkError('Only three agents can be created per user turn.');
            if (run.availableBots!.length >= 32)
              throw new SafeSdkError('The available bot roster is full.');
            // Server authority independently validates, persists, and checks cancellation.
            const result = await options.createAgent!(run.view.runId, clone(request));
            assertActive(run);
            const profile = validateParticipants([result])[0];
            if (
              profile.name !== request.name ||
              profile.purpose !== request.purpose ||
              JSON.stringify(profile.capabilities) !==
                JSON.stringify(normalizeCapabilities(request.capabilities)) ||
              profile.role !== 'agent' ||
              run.team!.some((bot) => bot.id === profile.id) ||
              run.availableBots!.some((bot) => bot.id === profile.id)
            ) {
              throw new SafeSdkError(
                'The created agent does not match the requested profile or has a conflicting identity.',
              );
            }
            run.availableBots = validateAvailableBots([...run.availableBots!, profile]);
            run.createdAgents.set(requestKey, profile);
            return boundedText(profile);
          },
        })
      : undefined;
  const messageAgentTool =
    privateCoordinator && options.messageAgent
      ? tool({
          name: 'message_agent',
          description:
            'Send a self-contained message to a registered agent and start its direct conversation. Delivery does not prove completed work and does not bypass workspace approvals.',
          parameters: messageAgentSchema,
          errorFunction: null,
          execute: async (input) => {
            assertActive(run);
            const request = messageAgentSchema.parse(input);
            requireSafeText(JSON.stringify(request));
            if (!run.availableBots!.some((profile) => profile.id === request.agentId))
              throw new SafeSdkError('Choose a registered agent ID.');
            const key = JSON.stringify(request),
              existing = run.deliveredMessages.get(key);
            if (existing) return boundedText(existing);
            if (run.deliveredMessages.size >= 3)
              throw new SafeSdkError('Only three distinct messages can be sent per user turn.');
            const result = await options.messageAgent!(run.view.runId, clone(request));
            assertActive(run);
            if (
              !result ||
              result.agentId !== request.agentId ||
              typeof result.conversationId !== 'string' ||
              !/^[A-Za-z0-9_-]{1,128}$/.test(result.conversationId)
            )
              throw new SafeSdkError('The message delivery metadata was invalid.');
            const metadata = { agentId: result.agentId, conversationId: result.conversationId };
            run.deliveredMessages.set(key, metadata);
            return boundedText(metadata);
          },
        })
      : undefined;
  const fleet = createFleetAgents({
    model: modelForRun(run),
    team: run.team,
    readTools,
    mutationTools,
    commandTools,
    workspaceToolsEnabled,
    workspaceRoot: options.workspaceRoot,
    webSearchEnabled,
    reasoningEffort,
    maxTurns: limits.maxTurns,
    maxOutputTokens: limits.maxOutputTokens,
    signal: run.controller.signal,
    conversationContext: run.conversationContext,
    availableBots: run.availableBots,
    groupTool,
    createAgentTool,
    messageAgentTool,
    memoryTools,
    memories,
  });
  for (const [role, agent] of Object.entries(fleet)) {
    agent.model = modelForRun(run, role as AgentId);
    agent.on('agent_start', () => emit(run, { type: 'agent_started', agent: agent.name }));
    agent.on('agent_end', (_context, output) => {
      const message = boundedText(output);
      emit(run, { type: 'agent_finished', agent: agent.name });
      const matched = run.sourceMessages.get(role as AgentId)?.find((item) => item.text === output);
      const sources = matched ? remapSources(matched.text, message, matched.sources) : [];
      if (message)
        emit(run, {
          type: 'agent_message',
          agent: agent.name,
          message,
          ...(sources.length ? { sources } : {}),
        });
    });
    agent.on('agent_tool_start', (_context, calledTool) =>
      emit(run, { type: 'tool_started', agent: agent.name, tool: calledTool.name }),
    );
    agent.on('agent_tool_end', (_context, calledTool) =>
      emit(run, { type: 'tool_finished', agent: agent.name, tool: calledTool.name }),
    );
  }
  return fleet;
}
