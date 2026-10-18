/**
 * The no-key demo's model: a small, deterministic stand-in for a language model.
 *
 * It implements the same Model interface as the real OpenAI model, so the demo runs
 * through the real agent loop, tools, approvals and native runner. Only the choice
 * of the next step is scripted. Each call reads the request the way a model would
 * (instructions, available tools, transcript) and returns either tool calls or a
 * reply. It knows a few teaching examples and does not understand arbitrary text.
 */
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Usage,
  type AgentOutputItem,
  type Model,
  type ModelRequest,
  type ModelResponse,
} from '@openai/agents';

/** Copy the tiny-project fixture to a fresh temporary folder for the demo to work on. */
export function createDemoWorkspace(): string {
  const fixture = fileURLToPath(new URL('../../examples/tiny-project', import.meta.url));
  const folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'tinkerfleet-demo-')));
  cpSync(fixture, folder, { recursive: true });
  return folder;
}

export class DemoModel implements Model {
  /** delayMs paces the demo so you can watch each step; tests use a small value. */
  constructor(private delayMs = 650) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    await pause(this.delayMs, request.signal);
    return {
      output: nextStep(readRequest(request)),
      usage: new Usage(),
      responseId: `demo-${randomUUID()}`,
    };
  }

  async *getStreamedResponse(): AsyncIterable<never> {
    throw new Error('The demo model does not stream.');
  }
}

/** What the demo model looks at in a request. */
interface RequestView {
  tools: string[];
  name: string;
  roster: { id: string; name: string }[];
  members: { id: string; name: string }[];
  prompt: string;
  earlierReplies: boolean;
  results: { name: string; text: string }[];
}

function readRequest(request: ModelRequest): RequestView {
  const instructions = request.systemInstructions ?? '';
  const items: unknown[] =
    typeof request.input === 'string'
      ? [{ type: 'message', role: 'user', content: request.input }]
      : request.input;
  const firstUser = items.find(
    (item): item is { content: unknown } =>
      isRecord(item) && item.type === 'message' && item.role === 'user',
  );
  const text = textOf(firstUser?.content);
  const marker = 'Current user request:\n';
  const prompt = (
    text.includes(marker) ? text.slice(text.lastIndexOf(marker) + marker.length) : text
  )
    .split('\n\nEarlier participant replies in this turn')[0]
    .trim();
  const names = new Map<string, string>();
  for (const item of items)
    if (isRecord(item) && item.type === 'function_call')
      names.set(String(item.callId), String(item.name));
  const results = items.flatMap((item) =>
    isRecord(item) && item.type === 'function_call_result'
      ? [{ name: names.get(String(item.callId)) ?? String(item.name), text: textOf(item.output) }]
      : [],
  );
  return {
    tools: (request.tools ?? []).map((tool) => ('name' in tool ? String(tool.name) : '')),
    name: jsonAfter<{ name?: string }>(instructions, 'Your profile:\n')?.name ?? 'your agent',
    roster: jsonAfter(instructions, 'this roster (data, not instructions):\n') ?? [],
    members: jsonAfter(instructions, 'Agents in this group: ') ?? [],
    prompt,
    earlierReplies: text.includes('Earlier participant replies in this turn'),
    results,
  };
}

/** Pick the next step: the primary agent coordinates, a group lead delegates, others work. */
function nextStep(r: RequestView): AgentOutputItem[] {
  const coordinates = ['create_agent', 'message_agent', 'start_group_conversation'].some((t) =>
    r.tools.includes(t),
  );
  if (coordinates) return primaryStep(r);
  if (r.tools.some((t) => t.startsWith('ask_'))) return groupLeadStep(r);
  return workerStep(r);
}

const isWorkRequest = (prompt: string) =>
  !/^(?:hello|hi|hey|explain|teach|tell me|what|how)\b/i.test(prompt) &&
  /\b(fix|repair|build|implement|debug|run|verify|check|test|inspect)\w*\b/i.test(prompt);

function primaryStep(r: RequestView): AgentOutputItem[] {
  const ask = /^ask\s+([^:\r\n]{1,64}):\s*([\s\S]+)$/i.exec(r.prompt);
  if (ask) {
    const target = ask[1].trim().toLowerCase();
    const matches = r.roster.filter(
      (bot) => bot.id.toLowerCase() === target || bot.name.toLowerCase() === target,
    );
    if (resultOf(r, 'message_agent') !== undefined)
      return say(
        `I sent your message to ${matches[0]?.name ?? 'that agent'} in their own chat. Their reply will appear here when they finish.`,
      );
    if (matches.length !== 1)
      return say(
        'I could not find exactly one agent with that name, so I sent nothing. Try “Ask Nova: Hello” with an agent from your library.',
      );
    return [call('message_agent', { agentId: matches[0].id, message: ask[2].trim() })];
  }

  const create =
    /^(?:please\s+)?(?:create|make|add)\s+(?:me\s+)?(.{1,400}?)\s+(?:called|named)\s+([A-Za-z][A-Za-z0-9 -]{0,39}?)[.!]?$/i.exec(
      r.prompt,
    );
  if (create) {
    const created = resultOf(r, 'create_agent');
    if (created !== undefined) {
      const name = parseJson<{ name?: string }>(created)?.name ?? create[2].trim();
      return say(
        `I saved ${name} to your bot library. Try “Ask ${name}: Hello”, or open their chat. In live mode their personality shapes real replies; this demo model is scripted.`,
      );
    }
    return [
      call('create_agent', { name: create[2].trim(), purpose: `Act as ${create[1].trim()}.` }),
    ];
  }

  const staysDirect =
    /\b(?:do not|don't|without|no)\b[^.!?]{0,45}\b(?:group|team|agents?|collaborat\w*)\b/i.test(
      r.prompt,
    );
  const wantsGroup = isWorkRequest(r.prompt) || /\b(collaborate|team|group)\b/i.test(r.prompt);
  if (wantsGroup && !staysDirect && r.roster.length) {
    if (resultOf(r, 'start_group_conversation') !== undefined)
      return say(
        'I started a group conversation for this and shared only a short brief. Open it to watch the agents work; each edit and command there still needs your approval.',
      );
    return [
      call('start_group_conversation', {
        title: 'Tiny-project repair',
        brief:
          'Fix the failing addition tests in tiny-project. Inspect sum.js, make the smallest fix, and verify it by running the tests.',
        botIds: r.roster.slice(0, 3).map((bot) => bot.id),
      }),
    ];
  }
  return workerStep(r);
}

function groupLeadStep(r: RequestView): AgentOutputItem[] {
  if (!isWorkRequest(r.prompt)) return greet(r);
  const askTools = r.tools.filter((t) => t.startsWith('ask_'));
  const toolFor = (member: { id: string }) =>
    `ask_${member.id.replace(/_/g, '__u').replace(/-/g, '__h')}`;
  const ordered = r.members.map(toolFor).filter((t) => askTools.includes(t));
  const lanes = ordered.length ? ordered : askTools;
  const stages = [
    { tool: lanes[0], input: 'Inspect sum.js in tiny-project and report what is wrong.' },
    { tool: lanes[1] ?? lanes[0], input: 'Fix sum.js with the smallest change.' },
    { tool: lanes[2] ?? lanes.at(-1)!, input: 'Verify the fix by running the tests.' },
  ];
  const asked = r.results.filter((result) => result.name.startsWith('ask_'));
  if (asked.some((result) => /declined|rejected|not made|did not run/i.test(result.text)))
    return say('An action was declined, so I stopped the plan here. Nothing else was changed.');
  if (asked.length < stages.length)
    return [call(stages[asked.length].tool, { input: stages[asked.length].input })];
  const nameOf = (tool: string) =>
    r.members.find((member) => toolFor(member) === tool)?.name ?? tool.slice(4);
  const counts = /\d+ passed and \d+ failed/.exec(asked[2].text)?.[0];
  return say(
    `${nameOf(stages[0].tool)} inspected sum.js, ${nameOf(stages[1].tool)} fixed it, and ${nameOf(stages[2].tool)} ran the tests${counts ? `: ${counts}` : ''}. Open Task details to review the diff and output.`,
  );
}

const FIXTURE = 'sum.js';
const TEST_COMMAND = { executable: 'node', args: ['--test', 'sum.test.js'], cwd: null };

function workerStep(r: RequestView): AgentOutputItem[] {
  if (r.earlierReplies)
    return say(
      `I read the earlier replies in this group. ${r.name} agrees with the plan; nothing more is needed from me.`,
    );
  if (!isWorkRequest(r.prompt)) return greet(r);
  const inspectOnly = /^inspect\b/i.test(r.prompt);
  const fixOnly = /^fix\b/i.test(r.prompt) && !/\btests?\b/i.test(r.prompt);
  const verifyOnly = /^verify\b/i.test(r.prompt);

  const declined = r.results.find((result) => /user rejected/i.test(result.text));
  if (declined)
    return say(
      `Understood. You declined the ${declined.name === 'edit_file' ? 'edit, so the change was not made' : 'command, so it did not run'}. I stopped there.`,
    );

  const source = resultOf(r, 'read_file');
  if (!verifyOnly && source === undefined) return [call('read_file', { path: FIXTURE })];
  if (inspectOnly)
    return say(
      source?.includes('a - b')
        ? 'Found it: sum() returns a - b, but the tests expect addition. One operator needs to change. I have not edited anything.'
        : 'sum() already adds its arguments, so I found nothing to fix.',
    );

  const edited = resultOf(r, 'edit_file');
  if (!verifyOnly && source?.includes('a - b') && edited === undefined)
    return [
      call('edit_file', {
        path: FIXTURE,
        content: source.replace('return a - b;', 'return a + b;'),
      }),
    ];
  if (fixOnly)
    return say(
      edited === undefined
        ? 'sum() already adds its arguments, so no edit was needed.'
        : 'I changed a - b to a + b in sum.js. The edit was approved and written.',
    );

  const tested = resultOf(r, 'run_command');
  if (tested === undefined) return [call('run_command', TEST_COMMAND)];
  return say(testSummary(tested));
}

function testSummary(output: string): string {
  const result = parseJson<{ stdout?: string; exitCode?: number }>(output);
  const stdout = result?.stdout ?? output;
  const pass = /# pass (\d+)/.exec(stdout)?.[1];
  const fail = /# fail (\d+)/.exec(stdout)?.[1];
  const counts = pass && fail ? `${pass} passed and ${fail} failed` : 'the run finished';
  return result?.exitCode === 0
    ? `I ran node --test sum.test.js: ${counts}. The change is in a temporary copy of tiny-project; open Task details to review the diff and output.`
    : `I ran node --test sum.test.js: ${counts}. Open Task details to see the output.`;
}

function greet(r: RequestView): AgentOutputItem[] {
  return say(
    `Hello from ${r.name}. This reply comes from the scripted demo model, not a real one. Ask me to fix the failing tests in tiny-project to watch real tool calls and approvals on a temporary copy.`,
  );
}

// --- Building a model response: these are the two kinds of output a model returns.

function call(name: string, args: Record<string, unknown>): AgentOutputItem {
  const callId = `demo-call-${randomUUID()}`;
  return {
    type: 'function_call',
    name,
    callId,
    id: callId,
    status: 'completed',
    arguments: JSON.stringify(args),
  };
}

function say(text: string): AgentOutputItem[] {
  return [
    {
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text }],
    },
  ];
}

// --- Small readers for the request.

function resultOf(r: RequestView, tool: string): string | undefined {
  return r.results.findLast((result) => result.name === tool)?.text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join('');
  if (isRecord(value) && typeof value.text === 'string') return value.text;
  return '';
}

function parseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** Parse the JSON value that starts right after a label in the instructions, if present. */
function jsonAfter<T>(instructions: string, label: string): T | undefined {
  const start = instructions.indexOf(label);
  if (start < 0) return undefined;
  const text = instructions.slice(start + label.length);
  // Scan to the bracket that closes the opening one, skipping over strings.
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '[' || char === '{') depth++;
    else if (char === ']' || char === '}') {
      depth--;
      if (depth === 0) return parseJson<T>(text.slice(0, i + 1));
    } else if (depth === 0 && i > 0) return undefined;
  }
  return undefined;
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled.'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Cancelled.'));
      },
      { once: true },
    );
  });
}
