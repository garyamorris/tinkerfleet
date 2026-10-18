/**
 * A trace of what each model call actually looked like: the request it sent and the reply it got.
 *
 * An agent has no memory between calls. Each step of its loop sends the whole conversation again,
 * plus the instructions and the tool list, and the model answers with text or a tool call. The
 * trace makes that visible. It is a bounded, redacted summary kept in server memory only: it is
 * never written to disk, it never holds model reasoning, and long text is shortened.
 */
import type { ModelRequest, ModelResponse } from '@openai/agents';
import type {
  AgentId,
  RunTrace,
  TraceCall,
  TraceItem,
  TraceItemKind,
  TraceTool,
} from '../../shared/types.js';
import { redactSdkText } from '../safety.js';

/** Every trace bound lives here; docs/capabilities.md#limits lists them for readers. */
export const TRACE_LIMITS = Object.freeze({
  itemChars: 1_500,
  instructionChars: 6_000,
  descriptionChars: 300,
  itemsPerCall: 60,
  toolsPerCall: 48,
  parametersPerTool: 16,
  callsPerRun: 48,
  charsPerRun: 1_000_000,
  charsInStore: 8_000_000,
  runs: 20,
});

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Redact first, then shorten, so a secret cut by the limit is never half shown. */
function clip(text: string, limit: number): string {
  const clean = redactSdkText(text);
  return clean.length <= limit ? clean : clean.slice(0, limit).replace(/[\uD800-\uDBFF]$/, '');
}

/** The readable text inside message content, which is a string or a list of typed parts. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!isRaw(part)) return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.refusal === 'string') return `[refusal] ${part.refusal}`;
      return typeof part.type === 'string' ? `[${part.type}]` : '';
    })
    .filter(Boolean)
    .join('\n');
}

/** A tool result's output is a string, a typed part, a list of parts, or command output. */
function outputText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.map(outputText).filter(Boolean).join('\n');
  if (!isRaw(output)) return '';
  if (typeof output.text === 'string') return output.text;
  const streams = ['stdout', 'stderr']
    .map((key) => output[key])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  return streams.length ? streams.join('\n') : (JSON.stringify(output) ?? '');
}

function item(kind: TraceItemKind, text: string, name?: unknown): TraceItem {
  return {
    kind,
    ...(typeof name === 'string' && name ? { name: clip(name, 80) } : {}),
    ...(text ? { text: clip(text, TRACE_LIMITS.itemChars) } : {}),
    chars: text.length,
  };
}

/** Describe one request or response item. Reasoning is counted, never copied. */
export function summarizeItem(value: unknown): TraceItem {
  if (!isRaw(value)) return item('other', '');
  const type = typeof value.type === 'string' ? value.type : 'message';
  if (type === 'message') {
    const role = value.role;
    const kind =
      role === 'user'
        ? 'user'
        : role === 'assistant'
          ? 'assistant'
          : role === 'system' || role === 'developer'
            ? 'system'
            : 'other';
    return item(kind, textOf(value.content));
  }
  if (type === 'reasoning') return item('reasoning', '');
  if (type === 'function_call')
    return item(
      'tool_call',
      typeof value.arguments === 'string' ? value.arguments : '',
      value.name,
    );
  if (type === 'hosted_tool_call') {
    // Web search is the one hosted tool; its query is public text the model chose to send.
    const provider = isRaw(value.providerData) ? value.providerData : {};
    const action = isRaw(provider.action) ? provider.action : {};
    const detail = [action.query, action.url, action.pattern].find(
      (part): part is string => typeof part === 'string' && part.length > 0,
    );
    return item('hosted_tool', detail ?? '', value.name);
  }
  if (/(?:_result|_output)$/.test(type))
    return item('tool_result', outputText(value.output), value.name);
  if (type.endsWith('_call')) return item('tool_call', '', value.name ?? type);
  return item('other', '', type);
}

export function summarizeTools(tools: readonly unknown[]): TraceTool[] {
  return tools.slice(0, TRACE_LIMITS.toolsPerCall).map((tool): TraceTool => {
    if (!isRaw(tool)) return { name: 'unknown', type: 'other' };
    const name = clip(String(tool.name ?? tool.type ?? 'unknown'), 80);
    if (tool.type === 'function') {
      const properties =
        isRaw(tool.parameters) && isRaw(tool.parameters.properties)
          ? Object.keys(tool.parameters.properties)
          : [];
      return {
        name,
        type: 'function',
        ...(typeof tool.description === 'string' && tool.description
          ? { description: clip(tool.description, TRACE_LIMITS.descriptionChars) }
          : {}),
        parameters: properties.slice(0, TRACE_LIMITS.parametersPerTool).map((p) => clip(p, 40)),
      };
    }
    return { name, type: tool.type === 'hosted_tool' ? 'hosted' : 'other' };
  });
}

export interface TraceCallInput {
  agent: AgentId;
  startedAt: number;
  durationMs: number;
  /** The request exactly as sent, after any trimming. */
  request: ModelRequest;
  charsBefore: number;
  charsSent: number;
  budget: number;
  removedItems: number;
  trimmedToolOutputs: number;
  response?: ModelResponse;
  /** A fixed, safe message; never a raw provider error. */
  error?: string;
}

export function summarizeCall(call: TraceCallInput): Omit<TraceCall, 'index'> {
  const { request, response } = call;
  const sent =
    typeof request.input === 'string' ? [{ role: 'user', content: request.input }] : request.input;
  const items = sent.map(summarizeItem);
  const kept = items.slice(-TRACE_LIMITS.itemsPerCall);
  const settings = request.modelSettings ?? {};
  const effort = settings.reasoning?.effort;
  return {
    agent: call.agent,
    at: call.startedAt,
    durationMs: call.durationMs,
    instructions: clip(request.systemInstructions ?? '', TRACE_LIMITS.instructionChars),
    instructionsChars: (request.systemInstructions ?? '').length,
    tools: summarizeTools(request.tools ?? []),
    settings: {
      ...(typeof effort === 'string' ? { reasoningEffort: effort } : {}),
      ...(typeof settings.maxTokens === 'number' ? { maxOutputTokens: settings.maxTokens } : {}),
      ...(typeof settings.toolChoice === 'string' ? { toolChoice: settings.toolChoice } : {}),
    },
    context: {
      chars: call.charsSent,
      charsBefore: call.charsBefore,
      budget: call.budget,
      removedItems: call.removedItems,
      trimmedToolOutputs: call.trimmedToolOutputs,
    },
    input: kept,
    omittedItems: items.length - kept.length,
    output: (response?.output ?? []).slice(0, TRACE_LIMITS.itemsPerCall).map(summarizeItem),
    usage: response
      ? {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          totalTokens: response.usage.totalTokens,
        }
      : null,
    ...(call.error ? { error: clip(call.error, 300) } : {}),
  };
}

const signature = (entry: TraceItem) =>
  `${entry.kind}|${entry.name ?? ''}|${entry.chars}|${entry.text ?? ''}`;

interface StoredRun {
  calls: TraceCall[];
  chars: number;
  truncated: boolean;
}

/** Traces for recent runs, in memory. The oldest run goes first when a limit is reached. */
export class TraceStore {
  private runs = new Map<string, StoredRun>();
  private chars = 0;

  record(runId: string, call: Omit<TraceCall, 'index'>): void {
    let run = this.runs.get(runId);
    if (!run) this.runs.set(runId, (run = { calls: [], chars: 0, truncated: false }));
    if (run.calls.length >= TRACE_LIMITS.callsPerRun) {
      run.truncated = true;
      return;
    }
    // Mark which request items this agent's previous call had not already sent. Everything else
    // was sent again, which is the point: the model starts from nothing on every call.
    const previous = run.calls.findLast((c) => c.agent === call.agent);
    const seen = previous && new Set(previous.input.map(signature));
    const entry: TraceCall = {
      ...call,
      input: seen ? call.input.map((i) => ({ ...i, fresh: !seen.has(signature(i)) })) : call.input,
      index: run.calls.length + 1,
    };
    const size = JSON.stringify(entry).length;
    if (run.chars + size > TRACE_LIMITS.charsPerRun) {
      run.truncated = true;
      return;
    }
    run.calls.push(entry);
    run.chars += size;
    this.chars += size;
    for (const [id, old] of this.runs) {
      if (this.runs.size <= TRACE_LIMITS.runs && this.chars <= TRACE_LIMITS.charsInStore) break;
      if (id === runId) continue;
      this.chars -= old.chars;
      this.runs.delete(id);
    }
  }

  /** The stored trace, or undefined when this server never recorded one (or has dropped it). */
  get(runId: string): RunTrace | undefined {
    const run = this.runs.get(runId);
    return run && { runId, available: true, calls: run.calls, truncated: run.truncated };
  }

  forget(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.chars -= run.chars;
    this.runs.delete(runId);
  }
}
