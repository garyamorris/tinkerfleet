export type AgentId = string;
export type PersonaRole = 'coordinator' | 'agent' | 'scout' | 'maker' | 'checker';
export interface Persona {
  id: string;
  name: string;
  purpose: string;
  role: PersonaRole;
  color: string;
  shape: 'orbit' | 'spark' | 'pebble' | 'gem';
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
export interface AppState {
  memories: MemoryEntry[];
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
