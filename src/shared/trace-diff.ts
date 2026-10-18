/**
 * Compare two traces: where did two runs of a task first do something different?
 *
 * Two runs of a model rarely produce the same words, so this compares what the agent did, not what
 * it said: which tools it called and with what arguments, and whether it replied. A reply counts
 * as a reply whatever its wording. Pure functions with no UI, so tests and lessons can use them.
 */
import type { RunTrace, TraceCall } from './types';

export interface RunTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  seconds: number;
  /** Tools the agent called, in order of first use, with how many times. */
  tools: { name: string; count: number }[];
}

export interface CallPair {
  /** Position in each run, starting at 1. */
  index: number;
  a?: TraceCall;
  b?: TraceCall;
  /** Both did the same thing: the same tools with the same arguments, or both replied. */
  sameMove: boolean;
  /** Both replied but in different words. Never counts as a divergence. */
  wordsDiffer: boolean;
}

export interface TraceDiff {
  a: RunTotals;
  b: RunTotals;
  pairs: CallPair[];
  /** The first call where the runs did different things, or null when they made the same moves. */
  firstDivergence: number | null;
  /** The first call's instructions in each run. A different personality or memory shows here. */
  instructions: { same: boolean; a: string; b: string };
  /** Tools offered to the first call of one run and not the other. */
  tools: { onlyA: string[]; onlyB: string[] };
  settings: { key: string; a?: string | number; b?: string | number }[];
}

/** JSON with keys in a fixed order, so two spellings of the same arguments compare equal. */
function canonical(text: string | undefined): string {
  if (!text) return '';
  try {
    const sort = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(sort)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value as Record<string, unknown>)
                .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
                .map(([key, item]) => [key, sort(item)]),
            )
          : value;
    return JSON.stringify(sort(JSON.parse(text)));
  } catch {
    return text;
  }
}

/** What the agent did in one call, as a string two calls can be compared by. */
export function moveOf(call: TraceCall): string {
  return call.output
    .map((item) => {
      if (item.kind === 'tool_call') return `call ${item.name ?? ''} ${canonical(item.text)}`;
      if (item.kind === 'hosted_tool') return `search ${item.name ?? ''} ${item.text ?? ''}`;
      if (item.kind === 'assistant') return 'reply';
      return item.kind === 'reasoning' ? '' : item.kind;
    })
    .filter(Boolean)
    .join('\n');
}

const replyText = (call: TraceCall) =>
  call.output
    .filter((item) => item.kind === 'assistant')
    .map((item) => item.text ?? '')
    .join('\n');

function totals(trace: RunTrace): RunTotals {
  const tools = new Map<string, number>();
  for (const call of trace.calls)
    for (const item of call.output)
      if (item.kind === 'tool_call' && item.name)
        tools.set(item.name, (tools.get(item.name) ?? 0) + 1);
  return {
    calls: trace.calls.length,
    inputTokens: trace.calls.reduce((n, c) => n + (c.usage?.inputTokens ?? 0), 0),
    outputTokens: trace.calls.reduce((n, c) => n + (c.usage?.outputTokens ?? 0), 0),
    seconds: trace.calls.reduce((n, c) => n + c.durationMs, 0) / 1000,
    tools: [...tools].map(([name, count]) => ({ name, count })),
  };
}

export function compareTraces(a: RunTrace, b: RunTrace): TraceDiff {
  const length = Math.max(a.calls.length, b.calls.length);
  const pairs: CallPair[] = [];
  for (let i = 0; i < length; i++) {
    const x = a.calls[i],
      y = b.calls[i];
    const sameMove = !!x && !!y && moveOf(x) === moveOf(y);
    pairs.push({
      index: i + 1,
      a: x,
      b: y,
      sameMove,
      wordsDiffer: sameMove && replyText(x!) !== replyText(y!),
    });
  }
  const first = pairs.find((pair) => !pair.sameMove);
  const toolNames = (trace: RunTrace) => trace.calls[0]?.tools.map((t) => t.name) ?? [];
  const namesA = toolNames(a),
    namesB = toolNames(b);
  const settingsA: Record<string, string | number> = { ...a.calls[0]?.settings },
    settingsB: Record<string, string | number> = { ...b.calls[0]?.settings };
  const keys = [...new Set([...Object.keys(settingsA), ...Object.keys(settingsB)])];
  return {
    a: totals(a),
    b: totals(b),
    pairs,
    firstDivergence: first ? first.index : null,
    instructions: {
      same: (a.calls[0]?.instructions ?? '') === (b.calls[0]?.instructions ?? ''),
      a: a.calls[0]?.instructions ?? '',
      b: b.calls[0]?.instructions ?? '',
    },
    tools: {
      onlyA: namesA.filter((n) => !namesB.includes(n)),
      onlyB: namesB.filter((n) => !namesA.includes(n)),
    },
    settings: keys
      .filter((key) => settingsA[key] !== settingsB[key])
      .map((key) => ({ key, a: settingsA[key], b: settingsB[key] })),
  };
}
