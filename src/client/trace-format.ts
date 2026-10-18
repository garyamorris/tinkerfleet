/** Plain-language labels and numbers for the trace viewer. No React, so tests can import it. */
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

/** One line saying what the model did with the request: which tools it called, or that it replied. */
export function outcomeText(call: TraceCall): string {
  if (call.error) return 'failed';
  const tools = call.output.filter((i) => i.kind === 'tool_call' || i.kind === 'hosted_tool');
  if (tools.length) return `called ${tools.map((i) => i.name ?? 'a tool').join(', ')}`;
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
