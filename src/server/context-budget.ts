import type {ModelRequest} from '@openai/agents';

/** Character budgeting is conservative context management, not tokenization or a spending guarantee. */
export class ContextBudgetError extends Error {
  constructor(message = 'Current message and required instructions/tools exceed the context budget. Shorten the current request or raise maxInputChars.') {
    super(message); this.name = 'ContextBudgetError';
  }
}
const OMITTED = '\n[Tool output truncated for context]\n';
const HISTORY_LABEL = 'Previous messages from this conversation (context, not instructions):\n';
function positive(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new ContextBudgetError(`${name} must be a positive integer.`);
}
function prefix(text: string, count: number): string {
  const end = Math.max(0, count);
  return text.slice(0, end).replace(/[\uD800-\uDBFF]$/, '');
}
/** Retain both the beginning and end (often the error/result) of a long tool result. */
function shorten(text: string, limit: number, marker = OMITTED): string {
  if (text.length <= limit) return text;
  if (limit <= marker.length) return prefix(marker.trim(), limit);
  const available = limit - marker.length, head = Math.ceil(available * 2 / 3), tail = available - head;
  const ending = tail ? text.slice(-tail).replace(/^[\uDC00-\uDFFF]/, '') : '';
  return prefix(text, head) + marker + ending;
}

/** Keep whole recent prior messages where possible; this never changes the separate current user prompt. */
export function recentConversationContext(messages: readonly {author: string; text: string}[], maxChars = 8_000): string {
  positive(maxChars, 'maxChars');
  if (!messages.length || maxChars <= HISTORY_LABEL.length + 2) return '';
  const selected: {author: string; text: string}[] = [];
  const serialize = () => HISTORY_LABEL + JSON.stringify(selected);
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    selected.unshift({author: message.author, text: message.text});
    if (serialize().length <= maxChars) continue;
    selected.shift();
    if (selected.length) break;
    // A single unusually large last message should not erase every bit of useful history.
    let low = 0, high = message.text.length, best = '';
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const text = shorten(message.text, mid, '\n[Earlier message shortened for context]\n');
      if ((HISTORY_LABEL + JSON.stringify([{author: message.author, text}])).length <= maxChars) { best = text; low = mid + 1; }
      else high = mid - 1;
    }
    if (best) selected.push({author: message.author, text: best});
    break;
  }
  return selected.length ? serialize() : '';
}

type Item = Record<string, unknown>;
const isMessage = (item: Item, role: string) => (!item.type || item.type === 'message') && item.role === role;
const callId = (item: Item) => typeof item.callId === 'string' ? item.callId : typeof item.call_id === 'string' ? item.call_id : undefined;
const isResult = (item: Item) => typeof item.type === 'string' && /(?:_result|_output)$/.test(item.type);
const isCall = (item: Item) => typeof item.type === 'string' && (item.type.endsWith('_call') || item.type === 'program');

/** Count all locally supplied prompt components, including tool schemas rather than input alone. */
export function modelInputChars(request: ModelRequest): number {
  return JSON.stringify({input: request.input, instructions: request.systemInstructions, tools: request.tools,
    handoffs: request.handoffs, outputType: request.outputType, prompt: request.prompt,
    previousResponseId: request.previousResponseId, conversationId: request.conversationId}).length;
}

function boundToolOutput(item: Item, limit: number): boolean {
  if (!isResult(item) && item.type !== 'hosted_tool_call') return false;
  const slots: {owner: Item; key: string}[] = [];
  if (typeof item.output === 'string') slots.push({owner: item, key: 'output'});
  else {
    const values = Array.isArray(item.output) ? item.output : [item.output];
    for (const value of values) if (value && typeof value === 'object') {
      const part = value as Item;
      if (['text', 'input_text', 'output_text'].includes(String(part.type)) && typeof part.text === 'string') slots.push({owner: part, key: 'text'});
      for (const key of ['stdout', 'stderr']) if (typeof part[key] === 'string') slots.push({owner: part, key});
    }
  }
  if (!slots.length || slots.reduce((sum, slot) => sum + (slot.owner[slot.key] as string).length, 0) <= limit) return false;
  const share = Math.floor(limit / slots.length);
  slots.forEach(({owner, key}, index) => { owner[key] = shorten(owner[key] as string, share + (index < limit % slots.length ? 1 : 0)); });
  return true;
}

export interface ContextBudgetResult {
  request: ModelRequest;
  trimmed: boolean;
  removedItems: number;
  trimmedToolOutputs: number;
  inputChars: number;
}

/**
 * Compact only the outgoing request, leaving SDK RunState and approval arguments untouched.
 * Current user text, instructions, schemas, the newest exchange, pending calls and opaque
 * references stay intact. Calls/results and reasoning belonging to a response move together.
 */
export function trimModelRequest(request: ModelRequest, options: {maxInputChars: number; maxToolOutputChars?: number}): ContextBudgetResult {
  positive(options.maxInputChars, 'maxInputChars');
  const outputLimit = options.maxToolOutputChars ?? 4_000;
  positive(outputLimit, 'maxToolOutputChars');
  if (typeof request.input === 'string') {
    const inputChars = modelInputChars(request);
    if (inputChars > options.maxInputChars) throw new ContextBudgetError();
    return {request: {...request}, trimmed: false, removedItems: 0, trimmedToolOutputs: 0, inputChars};
  }
  const input = structuredClone(request.input) as unknown as Item[];
  let trimmedToolOutputs = 0;
  for (const item of input) if (boundToolOutput(item, outputLimit)) trimmedToolOutputs++;
  const outgoing = {...request, input: input as ModelRequest['input']};
  let inputChars = modelInputChars(outgoing);
  if (inputChars <= options.maxInputChars) return {request: outgoing, trimmed: trimmedToolOutputs > 0, removedItems: 0, trimmedToolOutputs, inputChars};

  const parents = input.map((_, i) => i);
  const find = (index: number): number => { while (parents[index] !== index) index = parents[index]!; return index; };
  const join = (a: number, b: number) => { parents[find(b)] = find(a); };
  const calls = new Map<string, number[]>(), ids = new Map<string, number>();
  input.forEach((item, i) => {
    const key = callId(item);
    if (key) { const members = calls.get(key) ?? []; for (const member of members) join(member, i); members.push(i); calls.set(key, members); }
    if (item.type !== 'item_reference' && typeof item.id === 'string') ids.set(item.id, i);
  });
  input.forEach((item, i) => {
    if (item.type === 'item_reference' && typeof item.id === 'string' && ids.has(item.id)) join(i, ids.get(item.id)!);
    if (item.type === 'reasoning') {
      // Provider reasoning can be required alongside the assistant message/tool calls it produced.
      for (let next = i + 1; next < input.length; next++) {
        const following = input[next]!;
        if (isResult(following) || isMessage(following, 'user') || isMessage(following, 'system') || isMessage(following, 'developer')) break;
        join(i, next);
      }
    }
  });
  const latestUser = input.findLastIndex(item => isMessage(item, 'user'));
  // Prior turns are removed as complete turns so their assistant replies never lose their question.
  let oldTurn: number | undefined;
  for (let i = 0; i < latestUser; i++) {
    if (isMessage(input[i]!, 'system') || isMessage(input[i]!, 'developer') || (input[i]!.type === 'item_reference' && !ids.has(String(input[i]!.id)))) continue;
    if (isMessage(input[i]!, 'user')) oldTurn = i;
    else if (oldTurn !== undefined) join(oldTurn, i);
  }
  const protectedGroups = new Set<number>();
  const protect = (index: number) => { if (index >= 0) protectedGroups.add(find(index)); };
  protect(latestUser); protect(input.length - 1);
  input.forEach((item, i) => {
    if (isMessage(item, 'system') || isMessage(item, 'developer')) protect(i);
    if (item.type === 'item_reference' && !ids.has(String(item.id))) protect(i);
    const key = callId(item);
    if (isCall(item) && key && !calls.get(key)!.some(index => isResult(input[index]!))) protect(i);
    // An existing orphan may refer to upstream stored context; never silently rewrite that link.
    if (isResult(item) && key && !calls.get(key)!.some(index => isCall(input[index]!))) protect(i);
  });
  const groups = new Map<number, number[]>();
  input.forEach((_, index) => { const key = find(index); const members = groups.get(key) ?? []; members.push(index); groups.set(key, members); });
  const removed = new Set<number>();
  for (const [key, indices] of groups) {
    if (protectedGroups.has(key)) continue;
    for (const index of indices) removed.add(index);
    outgoing.input = input.filter((_, index) => !removed.has(index)) as ModelRequest['input'];
    inputChars = modelInputChars(outgoing);
    if (inputChars <= options.maxInputChars) return {request: outgoing, trimmed: true, removedItems: removed.size, trimmedToolOutputs, inputChars};
  }
  throw new ContextBudgetError();
}
