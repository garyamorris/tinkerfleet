import assert from 'node:assert/strict';
import test from 'node:test';
import { ScriptedModel, assistantMessage, functionCall } from '@openai/agents/testing';
import { TraceStore, createSdkAdapter, type SdkHarness } from '../src/server/sdk.js';
import { compareTraces, moveOf } from '../src/shared/trace-diff.js';
import type { Persona, RunTrace, TraceCall, TraceItem } from '../src/shared/types.js';

const item = (kind: TraceItem['kind'], name?: string, text?: string): TraceItem => ({
  kind,
  ...(name ? { name } : {}),
  ...(text !== undefined ? { text } : {}),
  chars: text?.length ?? 0,
});
const call = (index: number, output: TraceItem[], over: Partial<TraceCall> = {}): TraceCall => ({
  index,
  agent: 'coordinator',
  at: 0,
  durationMs: 1_000,
  instructions: 'Be helpful.',
  instructionsChars: 11,
  tools: [{ name: 'read_file', type: 'function' }],
  settings: { reasoningEffort: 'low' },
  context: { chars: 1, charsBefore: 1, budget: 10, removedItems: 0, trimmedToolOutputs: 0 },
  input: [],
  omittedItems: 0,
  output,
  usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
  ...over,
});
const trace = (...calls: TraceCall[]): RunTrace => ({
  runId: 'r',
  available: true,
  calls,
  truncated: false,
});
const reads = (path: string) => item('tool_call', 'read_file', JSON.stringify({ path }));

test('a move is what the agent did, so argument order and reply wording do not matter', () => {
  assert.equal(
    moveOf(call(1, [item('tool_call', 'edit_file', '{"path":"a","content":"x"}')])),
    moveOf(call(1, [item('tool_call', 'edit_file', '{"content":"x","path":"a"}')])),
  );
  assert.notEqual(moveOf(call(1, [reads('a.js')])), moveOf(call(1, [reads('b.js')])));
  assert.equal(
    moveOf(call(1, [item('assistant', undefined, 'Done.')])),
    moveOf(call(1, [item('assistant', undefined, 'All finished, thanks!')])),
  );
  assert.equal(moveOf(call(1, [item('reasoning'), item('assistant', undefined, 'x')])), 'reply');
  assert.notEqual(
    moveOf(call(1, [reads('a.js')])),
    moveOf(call(1, [reads('a.js'), reads('b.js')])),
    'asking for two files is not the same move as asking for one',
  );
  assert.equal(
    moveOf(call(1, [item('tool_call', 'run_command', 'not json')])),
    'call run_command not json',
  );
});

test('two runs that make the same moves have no divergence, even in different words', () => {
  const diff = compareTraces(
    trace(call(1, [reads('a.js')]), call(2, [item('assistant', undefined, 'It says hi.')])),
    trace(
      call(1, [reads('a.js')]),
      call(2, [item('assistant', undefined, 'The file greets you.')]),
    ),
  );
  assert.equal(diff.firstDivergence, null);
  assert.deepEqual(
    diff.pairs.map((p) => [p.sameMove, p.wordsDiffer]),
    [
      [true, false],
      [true, true],
    ],
  );
  assert.deepEqual(diff.a.tools, [{ name: 'read_file', count: 1 }]);
});

test('the first divergence is the first call that did something different, or the one missing', () => {
  const same = call(1, [reads('a.js')]);
  const apart = compareTraces(
    trace(same, call(2, [reads('b.js')]), call(3, [item('assistant', undefined, 'x')])),
    trace(same, call(2, [reads('c.js')]), call(3, [item('assistant', undefined, 'x')])),
  );
  assert.equal(apart.firstDivergence, 2);
  assert.equal(
    apart.pairs[2].sameMove,
    true,
    'later calls can match again; only the first split is reported',
  );

  const shorter = compareTraces(trace(same, call(2, [reads('b.js')])), trace(same));
  assert.equal(shorter.firstDivergence, 2);
  assert.equal(shorter.pairs[1].b, undefined);
  assert.equal(shorter.pairs[1].sameMove, false);

  const empty = compareTraces(trace(), trace());
  assert.equal(empty.firstDivergence, null);
  assert.deepEqual(empty.pairs, []);
  assert.equal(compareTraces(trace(), trace(same)).firstDivergence, 1);
});

test('totals, instructions, tools and settings are compared from the first call', () => {
  const diff = compareTraces(
    trace(
      call(1, [reads('a.js'), reads('b.js')], {
        instructions: 'Be brief.',
        tools: [
          { name: 'read_file', type: 'function' },
          { name: 'edit_file', type: 'function' },
        ],
        usage: { inputTokens: 500, outputTokens: 20, totalTokens: 520 },
      }),
      call(2, [item('assistant', undefined, 'ok')], { durationMs: 500 }),
    ),
    trace(
      call(1, [reads('a.js')], {
        instructions: 'Be thorough.',
        tools: [
          { name: 'read_file', type: 'function' },
          { name: 'web_search', type: 'hosted' },
        ],
        settings: { reasoningEffort: 'none', maxOutputTokens: 512 },
        usage: null,
      }),
    ),
  );
  assert.deepEqual(diff.a.tools, [{ name: 'read_file', count: 2 }]);
  assert.equal(diff.a.calls, 2);
  assert.equal(diff.a.inputTokens, 600);
  assert.equal(diff.a.seconds, 1.5);
  assert.equal(diff.b.inputTokens, 0, 'a call with no usage adds nothing');
  assert.deepEqual(diff.instructions, { same: false, a: 'Be brief.', b: 'Be thorough.' });
  assert.deepEqual(diff.tools, { onlyA: ['edit_file'], onlyB: ['web_search'] });
  assert.deepEqual(diff.settings, [
    { key: 'reasoningEffort', a: 'low', b: 'none' },
    { key: 'maxOutputTokens', a: undefined, b: 512 },
  ]);
});

// --- Real runs ------------------------------------------------------------------------------

const harness: SdkHarness = {
  snapshot: async () => ({ files: ['notes.txt', 'other.txt'], digest: '0'.repeat(64) }),
  readFile: async (_run, name) => `contents of ${name}`,
  prepare: async () => {
    throw new Error('No edits or commands here.');
  },
  decide: () => {},
  execute: async () => {
    throw new Error('No edits or commands here.');
  },
  cancel: () => {},
};
const persona = (purpose: string): Persona => ({
  id: 'primary',
  role: 'coordinator',
  name: 'Orbit',
  purpose,
  color: '#567a75',
  shape: 'orbit',
});

async function run(
  id: string,
  steps: ConstructorParameters<typeof ScriptedModel>[0],
  options: { purpose?: string; effort?: 'none' | 'low' } = {},
) {
  const store = new TraceStore();
  const done = await createSdkAdapter({
    harness,
    model: new ScriptedModel(steps),
    trace: store,
    webSearchEnabled: false,
    workspaceToolsEnabled: true,
    reasoningEffort: options.effort,
  }).start({
    runId: id,
    prompt: 'What is in notes.txt?',
    team: [persona(options.purpose ?? 'Help the user.')],
  });
  assert.equal(done.status, 'completed');
  return store.get(id)!;
}

test('comparing real runs finds a different argument, a different personality, and a different setting', async () => {
  const baseline = await run('a', [
    [functionCall('read_file', { path: 'notes.txt' }, { callId: 'r' })],
    [assistantMessage('It says: contents of notes.txt')],
  ]);

  // The same moves in different words: no divergence.
  const reworded = await run('b', [
    [functionCall('read_file', { path: 'notes.txt' }, { callId: 'r' })],
    [assistantMessage('The notes file reads "contents of notes.txt".')],
  ]);
  const same = compareTraces(baseline, reworded);
  assert.equal(same.firstDivergence, null);
  assert.equal(same.pairs[1].wordsDiffer, true);
  assert.equal(same.instructions.same, true);
  assert.deepEqual(same.settings, []);

  // The agent reads a different file: the runs split at the first call.
  const elsewhere = await run('c', [
    [functionCall('read_file', { path: 'other.txt' }, { callId: 'r' })],
    [assistantMessage('It says: contents of other.txt')],
  ]);
  const split = compareTraces(baseline, elsewhere);
  assert.equal(split.firstDivergence, 1);
  assert.equal(split.pairs[1].sameMove, true, 'both then reply');

  // A different personality is visible in the instructions, even when the moves match.
  const terse = await run(
    'd',
    [
      [functionCall('read_file', { path: 'notes.txt' }, { callId: 'r' })],
      [assistantMessage('Done.')],
    ],
    { purpose: 'Answer in one word.' },
  );
  const personality = compareTraces(baseline, terse);
  assert.equal(personality.firstDivergence, null);
  assert.equal(personality.instructions.same, false);
  assert.match(personality.instructions.b, /Answer in one word/);

  // A different reasoning effort shows up in the settings.
  const effort = await run(
    'e',
    [
      [functionCall('read_file', { path: 'notes.txt' }, { callId: 'r' })],
      [assistantMessage('Done.')],
    ],
    { effort: 'none' },
  );
  assert.deepEqual(compareTraces(baseline, effort).settings, [
    { key: 'reasoningEffort', a: undefined, b: 'none' },
  ]);
});
