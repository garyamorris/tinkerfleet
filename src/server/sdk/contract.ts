/** Types and limits shared by the agent layer, the HTTP app and tests. */
import type {
  Capability,
  Persona,
  Message,
  MessageSource,
  MemoryEntry,
} from '../../shared/types.js';
import type { Model } from '@openai/agents';
import type { TraceStore } from './trace.js';

export type SdkAction =
  | { kind: 'command'; executable: string; args: string[]; cwd?: string }
  | { kind: 'edit'; path: string; content: string };

export interface SdkPreparedApproval {
  id: string;
  runId: string;
  digest: string;
  action: SdkAction;
  expiresAt?: number | string;
}

/** All methods are trusted server callbacks. No callback is supplied by a client. */
export interface SdkHarness {
  snapshot(runId: string): Promise<{ files: string[]; digest: string }>;
  readFile(runId: string, path: string): Promise<string>;
  /** Pure validation/preview: must not execute the action. */
  prepare(runId: string, action: SdkAction): Promise<SdkPreparedApproval>;
  /** Must validate run ID, pending state, and immutable digest again. */
  decide(
    runId: string,
    approvalId: string,
    digest: string,
    approved: boolean,
  ): unknown | Promise<unknown>;
  /** Must atomically consume the approved record and recheck its snapshot digest. */
  execute(runId: string, approvalId: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  cancel(runId: string): void | Promise<void>;
}

export interface SdkLimits {
  maxTurns: number;
  maxModelCalls: number;
  maxOutputTokens: number;
  maxTotalTokens: number;
  maxInputChars: number;
  maxOutputChars: number;
  maxRunMs: number;
  maxPendingMs: number;
  maxRetainedRuns: number;
}

export const DEFAULT_SDK_LIMITS: Readonly<SdkLimits> = Object.freeze({
  maxTurns: 0,
  maxModelCalls: 0,
  maxOutputTokens: 2_048,
  maxTotalTokens: 64_000,
  maxInputChars: 64_000,
  maxOutputChars: 32_000,
  maxRunMs: 120_000,
  maxPendingMs: 10 * 60_000,
  maxRetainedRuns: 20,
});

export const SDK_BUDGET_NOTE =
  'Token usage, each response, active runtime, and tool output are bounded. Turn and model-call counts are unlimited unless explicitly configured. ' +
  'Reported token usage stops subsequent calls after the threshold; the response that crosses it is already billed. ' +
  'These are safety limits, not a guaranteed dollar spending cap. Configure account-level budget controls separately. ' +
  'Live runs send the prompt and permitted workspace content to the selected OpenAI runtime model.';

export interface SdkUsage {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
export type SdkRunStatus =
  'running' | 'awaiting_approval' | 'completed' | 'cancelled' | 'error' | 'deferred';
export interface SdkPendingApproval {
  approvalId: string;
  runId: string;
  digest: string;
  agent: string;
  tool: 'run_command' | 'edit_file';
  action: SdkAction;
}
export interface SdkStatus {
  runId: string;
  status: SdkRunStatus;
  pendingApprovals: SdkPendingApproval[];
  usage: SdkUsage;
  output?: string;
  message?: string;
}
export interface SdkEvent {
  runId: string;
  type:
    | 'run_started'
    | 'agent_started'
    | 'agent_finished'
    | 'agent_message'
    | 'tool_started'
    | 'tool_finished'
    | 'approval_requested'
    | 'approval_resolved'
    | 'run_completed'
    | 'run_failed'
    | 'run_cancelled'
    | 'usage';
  at: string;
  agent?: string;
  tool?: string;
  message?: string;
  sources?: MessageSource[];
  approval?: SdkPendingApproval;
  approvalId?: string;
  approved?: boolean;
  usage?: SdkUsage;
}
export interface SdkStartGroupRequest {
  title: string;
  brief: string;
  botIds: string[];
}
export interface SdkStartedGroup {
  conversationId: string;
  title: string;
}
export interface SdkCreateAgentRequest {
  name: string;
  purpose: string;
  /** Asked for by the model; edit, run, and web with read wait for the user to grant them. */
  capabilities: Capability[];
}
export interface SdkMessageAgentRequest {
  agentId: string;
  message: string;
}
export interface SdkMessagedAgent {
  conversationId: string;
  agentId: string;
}
export type SdkReasoningEffort = 'none' | 'minimal' | 'low';
export interface SdkMemory {
  list(agentId: string): Promise<MemoryEntry[]> | MemoryEntry[];
  remember(agentId: string, text: string): Promise<MemoryEntry>;
  forget(agentId: string, memoryId: string): Promise<boolean>;
}
export interface SdkAdapterOptions {
  harness: SdkHarness;
  /** Trusted storage; all memory callbacks are scoped to the actual saved Persona.id. */
  memory?: SdkMemory;
  /** Disable all workspace capabilities and harness callbacks for conversation-only runs. */
  workspaceToolsEnabled?: boolean;
  /** Trusted server-selected absolute workspace path; never supplied by a model tool call. */
  workspaceRoot?: string;
  /** Hosted public web search; defaults on for live adapters, independently of workspace tools. */
  webSearchEnabled?: boolean;
  /** Internally consume Responses streams for safe hosted-tool activity; live provider default is true. */
  streamWebActivity?: boolean;
  reasoningEffort?: SdkReasoningEffort;
  /** Trusted server callback: create and start one child group from registered bot IDs. */
  startGroup?: (runId: string, request: SdkStartGroupRequest) => Promise<SdkStartedGroup>;
  /** Trusted server callback: persist a new reusable agent and update the source roster. */
  createAgent?: (runId: string, request: SdkCreateAgentRequest) => Promise<Persona>;
  /** Trusted server callback: deliver a private message to a registered agent. */
  messageAgent?: (runId: string, request: SdkMessageAgentRequest) => Promise<SdkMessagedAgent>;
  onEvent?: (event: SdkEvent) => void;
  /** Where each model call is summarized for the trace viewer. Memory only; omit to record nothing. */
  trace?: TraceStore;
  /** A Model object replaces network I/O in tests. Strings are runtime model IDs. */
  model?: string | Model;
  /** Explicit opt-in; default comes from TINKERFLEET_MODE=live. */
  liveEnabled?: boolean;
  limits?: Partial<SdkLimits>;
}
export interface SdkAdapter {
  start(input: {
    runId: string;
    prompt: string;
    team?: Persona[];
    history?: Message[];
    availableBots?: Persona[];
  }): Promise<SdkStatus>;
  resume(input: {
    runId: string;
    approvalId: string;
    digest: string;
    approved: boolean;
  }): Promise<SdkStatus>;
  cancel(runId: string): Promise<SdkStatus | undefined>;
  getStatus(runId: string): SdkStatus | undefined;
  /** Drop a finished run, or cancel and forget an unfinished run. */
  dispose(runId: string): Promise<void>;
}
