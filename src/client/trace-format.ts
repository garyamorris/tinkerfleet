/** Plain-language labels and numbers for the trace viewer. No React, so tests can import it. */
import type { TraceDiff } from '../shared/trace-diff';
import type { TraceCall, TraceItem, TraceItemKind } from '../shared/types';

export const kindLabel: Record<TraceItemKind, string> = {
  system: 'Instructions',
  user: 'User',
  assistant: 'Assistant',
  tool_call: 'Tool call',
  tool_result: 'Tool result',
  hosted_tool: 'Web search',
  reasoning: 'Reasoning (hidden)',
  other: 'Other',
};

/** How full the context window was, and what Tinkerfleet did to make the request fit. */
export function contextSummary(call: TraceCall): { percent: number; notes: string[] } {
  const { chars, charsBefore, budget, removedItems, trimmedToolOutputs } = call.context;
  const notes = [`${chars.toLocaleString()} of ${budget.toLocaleString()} characters allowed`];
  if (removedItems)
    notes.push(
      `${removedItems} older ${removedItems === 1 ? 'item was' : 'items were'} dropped to fit (${charsBefore.toLocaleString()} characters before trimming)`,
    );
  if (trimmedToolOutputs)
    notes.push(
      `${trimmedToolOutputs} long tool ${trimmedToolOutputs === 1 ? 'output was' : 'outputs were'} shortened`,
    );
  if (call.omittedItems)
    notes.push(
      `${call.omittedItems} oldest ${call.omittedItems === 1 ? 'item is' : 'items are'} not shown here`,
    );
  return { percent: budget > 0 ? Math.min(100, Math.round((chars / budget) * 100)) : 0, notes };
}

/**
 * The bot an ask_ tool reaches, decoded from the tool's name, or null for any other tool. This
 * reverses the naming in src/server/sdk/fleet.ts: `_` becomes `__u` and `-` becomes `__h`.
 */
export function askedBotId(tool: string): string | null {
  if (!tool.startsWith('ask_')) return null;
  return tool.slice(4).replace(/__([uh])/g, (_, c: string) => (c === 'u' ? '_' : '-'));
}

/**
 * One line saying what the model did with the request: which tools it called, or that it replied.
 * Given bot names, a call to another bot reads "asked Maker" instead of its tool name.
 */
export function outcomeText(call: TraceCall, botName?: (id: string) => string | undefined): string {
  if (call.error) return 'failed';
  const tools = call.output.filter((i) => i.kind === 'tool_call' || i.kind === 'hosted_tool');
  if (tools.length) {
    const asked: string[] = [],
      called: string[] = [];
    for (const item of tools) {
      const id = item.name ? askedBotId(item.name) : null,
        name = id === null ? undefined : botName?.(id);
      if (name) asked.push(name);
      else called.push(item.name ?? 'a tool');
    }
    return [
      called.length ? `called ${called.join(', ')}` : '',
      asked.length ? `asked ${asked.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join(' and ');
  }
  return call.output.some((i) => i.kind === 'assistant') ? 'replied' : 'returned nothing visible';
}

/**
 * Across the calls, how much of each request had already been sent by the same agent's previous
 * call. This is the loop's cost made visible: the model starts from nothing every time.
 */
export function resendShare(calls: readonly TraceCall[]): number | null {
  let resent = 0,
    total = 0;
  for (const call of calls)
    for (const item of call.input)
      if (item.fresh !== undefined) {
        total++;
        if (!item.fresh) resent++;
      }
  return total ? Math.round((resent / total) * 100) : null;
}

export function totalTokens(calls: readonly TraceCall[]): { input: number; output: number } {
  return calls.reduce(
    (sum, call) => ({
      input: sum.input + (call.usage?.inputTokens ?? 0),
      output: sum.output + (call.usage?.outputTokens ?? 0),
    }),
    { input: 0, output: 0 },
  );
}

/** Tool-call arguments arrive as one line of JSON; show them indented when the whole text parsed. */
export function readableText(item: TraceItem): string {
  const text = item.text ?? '';
  if (item.kind !== 'tool_call' || text.length < item.chars) return text;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' ? JSON.stringify(value, null, 2) : text;
  } catch {
    return text;
  }
}

const what = (call?: TraceCall) => (call ? outcomeText(call) : 'made no call');
const toolNames = (call?: TraceCall) =>
  (call?.output ?? []).filter((i) => i.kind === 'tool_call').map((i) => i.name ?? '');

/** A tool call's arguments on one line, shortened, so two calls to the same tool can be told apart. */
export function argsOf(call: TraceCall, limit = 90): string {
  const text = call.output
    .filter((i) => i.kind === 'tool_call')
    .map((i) => `${i.name ?? ''} ${(i.text ?? '').replace(/\s+/g, ' ')}`.trim())
    .join('; ');
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** One sentence: the same moves, or the first place the two tasks parted ways. */
export function verdict(diff: TraceDiff): string {
  if (diff.firstDivergence === null) {
    const words = diff.pairs.some((p) => p.wordsDiffer);
    return `Both tasks made the same moves${words ? ', though their replies were worded differently' : ''}.`;
  }
  const pair = diff.pairs[diff.firstDivergence - 1];
  const names = toolNames(pair.a);
  if (pair.a && pair.b && names.length && names.join() === toolNames(pair.b).join())
    return `They first differ at call ${pair.index}: both called ${names.join(', ')}, but with different arguments.`;
  return `They first differ at call ${pair.index}: this task ${what(pair.a)}, the other ${what(pair.b)}.`;
}
