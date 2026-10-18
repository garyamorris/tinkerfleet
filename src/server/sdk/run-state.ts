/** The private, server-only state of one run, and helpers that every run step uses. */
import type { Agent, RunState, RunToolApprovalItem } from '@openai/agents';
import type { AgentId, MessageSource, Persona } from '../../shared/types.js';
import type {
  SdkMessagedAgent,
  SdkPendingApproval,
  SdkStartedGroup,
  SdkStatus,
} from './contract.js';
import { SafeSdkError } from './errors.js';
import type { createFleetAgents } from './fleet.js';

export function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new SafeSdkError('Run cancelled.'));
    if (signal.aborted) {
      void promise.catch(() => {});
      aborted();
      return;
    }
    signal.addEventListener('abort', aborted, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', aborted))
      .catch(() => {});
  });
}

export interface Pending {
  item: RunToolApprovalItem;
  view: SdkPendingApproval;
  callId: string;
}
export interface PrivateRun {
  team?: Persona[];
  availableBots?: Persona[];
  createdGroup?: { request: string; result: SdkStartedGroup };
  createdAgents: Map<string, Persona>;
  deliveredMessages: Map<string, SdkMessagedAgent>;
  sourceMessages: Map<AgentId, { text: string; sources: MessageSource[] }[]>;
  roots: AgentId[];
  phase: number;
  decisionDenied: boolean;
  input: string;
  conversationContext: string;
  outputs: { agent: string; text: string }[];
  view: SdkStatus;
  controller: AbortController;
  fleet?: ReturnType<typeof createFleetAgents>;
  state?: RunState<unknown, Agent<unknown>>;
  /** Approvals waiting for the user, by approval ID. */
  pending: Map<string, Pending>;
  /** Approved tool calls not yet executed: SDK call ID -> approval ID. Each is used once. */
  approvedCalls: Map<string, string>;
  busy: boolean;
  activeMs: number;
  expiry?: ReturnType<typeof setTimeout>;
}

export const clone = <T>(value: T): T => structuredClone(value);

export function assertActive(run: PrivateRun): void {
  if (run.controller.signal.aborted) throw new SafeSdkError('Run cancelled.');
}
