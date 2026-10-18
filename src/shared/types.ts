export type AgentId = string;
export type PersonaRole = 'coordinator' | 'agent' | 'scout' | 'maker' | 'checker';
/** A group of tools a profile can ask for. See src/shared/capabilities.ts. */
export type Capability = 'web' | 'read' | 'edit' | 'run' | 'memory';
export interface Persona {
  id: string;
  name: string;
  purpose: string;
  role: PersonaRole;
  color: string;
  shape: 'orbit' | 'spark' | 'pebble' | 'gem';
  /**
   * The tool groups this bot asks for. The server's own switches still cap them. Missing means
   * a profile saved before capabilities existed: it gets every enabled tool, as it always did.
   */
  capabilities?: Capability[];
}
export type RunStatus =
  'idle' | 'running' | 'awaiting_approval' | 'completed' | 'denied' | 'cancelled' | 'failed';
export type Action =
  | { kind: 'edit'; path: string; content: string }
  | {
      kind: 'command';
      resolvedExecutable?: { path: string; identity: string } | null;
      executable: string;
      args: string[];
      cwd?: string;
    };
export interface Approval {
  id: string;
  digest: string;
  agent: AgentId;
  title: string;
  description: string;
  action: Action;
  status: 'pending' | 'approved' | 'denied';
  before?: string;
}
export interface FleetEvent {
  id: string;
  at: number;
  agent: AgentId;
  kind: 'message' | 'delegation' | 'tool' | 'approval' | 'result' | 'error';
  title: string;
  detail?: string;
}
export interface MessageSource {
  url: string;
  title: string;
  startIndex?: number;
  endIndex?: number;
}
export interface Message {
  replyToRunId?: string;
  recipientRunId?: string;
  sources?: MessageSource[];
  createdAgentId?: string;
  /** Capabilities a created bot asked for that wait for the user to grant them. */
  requestedCapabilities?: Capability[];
  conversationId?: string;
  id: string;
  author: AgentId | 'user';
  text: string;
  kind?: 'text' | 'delegation' | 'result';
  at: number;
}
export interface Artifact {
  path: string;
  before: string;
  after: string;
  simulated: boolean;
}
export interface Conversation {
  availableBots?: Persona[];
  startedBy?: { conversationId: string; runId: string; coordinatorId: string; brief: string };
  id: string;
  title: string;
  participants: Persona[];
  createdAt: number;
  updatedAt: number;
  draft: string;
  currentRunId: string | null;
}
export interface RunUsage {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
export interface Run {
  sentBy?: { conversationId: string; runId: string; coordinatorId: string };
  /** Set when the server started this run on its own, from this schedule. */
  scheduleId?: string;
  usage?: RunUsage;
  conversationId?: string;
  team?: Persona[];
  id: string;
  prompt: string;
  status: RunStatus;
  mode: 'demo' | 'live';
  messages: Message[];
  events: FleetEvent[];
  approvals: Approval[];
  artifacts: Artifact[];
  output: string;
  activeAgent: AgentId | null;
  startedAt: number;
  endedAt?: number;
}
export interface MemoryEntry {
  id: string;
  agentId: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}
/**
 * A trace is what one run's model calls actually looked like: the request each call sent and the
 * response it got back. It is a bounded, redacted summary held in server memory, not the raw
 * provider payload, and it never contains model reasoning.
 */
export type TraceItemKind =
  | 'system'
  | 'user'
  | 'assistant'
  | 'tool_call'
  | 'tool_result'
  | 'hosted_tool'
  | 'reasoning'
  | 'other';
export interface TraceItem {
  kind: TraceItemKind;
  /** The tool name, for tool calls and results. */
  name?: string;
  /** The text, shortened to the trace limit. `chars` is the full length before shortening. */
  text?: string;
  chars: number;
  /** On request items: true when the previous call from this agent did not already send it. */
  fresh?: boolean;
}
export interface TraceTool {
  name: string;
  type: 'function' | 'hosted' | 'other';
  description?: string;
  /** Argument names the model may fill in, for function tools. */
  parameters?: string[];
}
export interface TraceCall {
  /** Position in the run, starting at 1. */
  index: number;
  agent: AgentId;
  at: number;
  durationMs: number;
  instructions: string;
  instructionsChars: number;
  tools: TraceTool[];
  settings: { reasoningEffort?: string; maxOutputTokens?: number; toolChoice?: string };
  /** Characters sent after trimming, the limit, and what trimming did. `charsBefore` is untrimmed. */
  context: {
    chars: number;
    charsBefore: number;
    budget: number;
    removedItems: number;
    trimmedToolOutputs: number;
  };
  /** What was sent. When a long history is shortened for the trace, `omittedItems` counts the oldest. */
  input: TraceItem[];
  omittedItems: number;
  /** What came back. Empty when the call failed. */
  output: TraceItem[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
  /** A fixed, safe message when the call failed. */
  error?: string;
}
export interface RunTrace {
  runId: string;
  /** False when this server has no trace for the run, for example after a restart. */
  available: boolean;
  calls: TraceCall[];
  /** True when limits stopped the trace from recording every call. */
  truncated: boolean;
}
/**
 * A saved prompt the server sends to one bot on its own, at one time of day on chosen days of the
 * week, in the server's local time. See src/server/schedules.ts.
 */
export interface Schedule {
  id: string;
  botId: string;
  prompt: string;
  /** Days of the week it runs: 0 is Sunday, 6 is Saturday. */
  days: number[];
  /** 24-hour 'HH:MM'. */
  time: string;
  paused: boolean;
  createdAt: number;
  updatedAt: number;
  /** Due times at or before this are never run. It moves forward on create, edit, resume, and each run. */
  handledThrough: number;
  /** What happened the last time it was due: the run it started, or why it was skipped. */
  lastRun?: { at: number; runId?: string; conversationId?: string; skipped?: string };
}
export interface ScheduleView extends Schedule {
  /** When it is next due, or null while paused. */
  nextRunAt: number | null;
}
export interface AppState {
  memories: MemoryEntry[];
  schedules: ScheduleView[];
  /** Only live mode runs schedules; the demo shows them but never fires them. */
  schedulesRun: boolean;
  /** The server's time zone, which schedule times use. */
  timeZone: string;
  webSearchEnabled: boolean;
  profiles: Persona[];
  workspaceToolsEnabled: boolean;
  reasoningEffort: 'none' | 'minimal' | 'low' | null;
  limits: {
    maxModelCalls: number;
    maxOutputTokens: number;
    maxTotalTokens: number;
    maxRunMs: number;
  };
  conversations: Conversation[];
  persistenceError?: string;
  mode: 'demo' | 'live';
  model: string | null;
  workspace: string;
  workspaceRoot: string;
  execution: { available: boolean; reason: string };
  liveReady: boolean;
  runs: Run[];
  currentRunId: string | null;
  maxTurns: number;
}
export const initialSource = 'export function sum(a, b) {\n  return a - b;\n}\n';
export const fixedSource = 'export function sum(a, b) {\n  return a + b;\n}\n';
