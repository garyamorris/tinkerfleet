/**
 * Lesson 10: read a trace, the record of what each model call sent and got back.
 *
 * An agent has no memory between model calls. This lesson runs a two-step task through the
 * app's real adapter and prints its trace, the same data the app's Trace tab shows.
 *
 *   npm run lesson:10
 */
import assert from 'node:assert/strict';
import { ScriptedModel, assistantMessage, functionCall } from '@openai/agents/testing';
import { TraceStore, createSdkAdapter, type SdkHarness } from '../src/server/sdk.js';

// A stand-in workspace with one long file, so the lesson needs no real files.
const longFile = 'a line of notes\n'.repeat(1_000);
const harness: SdkHarness = {
  snapshot: async () => ({ files: ['notes.txt'], digest: '0'.repeat(64) }),
  readFile: async () => longFile,
  prepare: async () => {
    throw new Error('This lesson proposes no edits or commands.');
  },
  decide: () => {},
  execute: async () => {
    throw new Error('This lesson proposes no edits or commands.');
  },
  cancel: () => {},
};

const model = new ScriptedModel([
  [functionCall('read_file', { path: 'notes.txt' }, { callId: 'read-1' })],
  [assistantMessage('notes.txt has 1,000 lines.')],
]);
const trace = new TraceStore();
const adapter = createSdkAdapter({
  harness,
  model,
  trace,
  webSearchEnabled: false,
  workspaceToolsEnabled: true,
});
const done = await adapter.start({
  runId: 'lesson-10',
  prompt: 'How long is notes.txt?',
  team: [
    {
      id: 'primary',
      role: 'coordinator',
      name: 'Orbit',
      purpose: 'Help the user.',
      color: '#567a75',
      shape: 'orbit',
    },
  ],
});
assert.equal(done.status, 'completed');

// The trace holds one entry per model call, in order.
const { calls } = trace.get('lesson-10')!;
assert.equal(calls.length, 2);
for (const call of calls) {
  const fresh = call.input.filter((item) => item.fresh).length;
  const resent = call.input.filter((item) => item.fresh === false).length;
  const sent = call.input.map((item) => item.kind + (item.name ? `:${item.name}` : '')).join(', ');
  const replied = call.output
    .map((item) => item.kind + (item.name ? `:${item.name}` : ''))
    .join(', ');
  console.log(`  call ${call.index}: sent [${sent}]`);
  console.log(
    `          ${call.index === 1 ? 'the first request, nothing to compare with' : `${resent} item(s) sent before, ${fresh} new`}; replied [${replied}]`,
  );
}

const [first, second] = calls;

// 1. The model starts from nothing every time: call 2 sends call 1's request again, plus the
//    tool call and its result. Only those two are new.
assert.deepEqual(
  second.input.map((item) => [item.kind, item.fresh]),
  [
    ['user', false],
    ['tool_call', true],
    ['tool_result', true],
  ],
);

// 2. Your question is a small part of the request. Instructions and tool definitions go with
//    every call, and usually outweigh the conversation.
const question = first.input[0].chars;
console.log(
  `  your question: ${question} characters; the instructions: ${first.instructionsChars}; ` +
    `${first.tools.length} tools were offered`,
);
assert.ok(first.instructionsChars > question * 10);
assert.ok(first.tools.some((tool) => tool.name === 'read_file'));

// 3. The context window has a budget. A long tool result is shortened before it is sent again,
//    and the trace shows what was sent, not what your code returned.
const result = second.input.find((item) => item.kind === 'tool_result')!;
console.log(
  `  the tool returned ${longFile.length} characters; the whole request was ` +
    `${second.context.charsBefore} before trimming and ${second.context.chars} when sent`,
);
assert.equal(second.context.trimmedToolOutputs, 1);
assert.ok(second.context.chars < second.context.charsBefore);
assert.ok(result.chars < longFile.length);

console.log(
  '10. Trace: the model starts from nothing on every call, so each step sends everything again.',
);
console.log(
  'Exercise: add a third scripted call. How many items does it send, and how many are new?',
);
