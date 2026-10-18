/**
 * Lesson 11: compare two runs of a task.
 *
 * Two runs of a model rarely say the same words, so a useful comparison asks a different
 * question: where did they first do something different? This lesson makes three runs of one
 * task, changes one thing each time, and compares each with the first. The same comparison is
 * in the app: choose "Compare with another task" in a task's Trace tab.
 *
 *   npm run lesson:11
 */
import assert from 'node:assert/strict';
import { ScriptedModel, assistantMessage, functionCall } from '@openai/agents/testing';
import { verdict } from '../src/client/trace-format.js';
import { TraceStore, createSdkAdapter, type SdkHarness } from '../src/server/sdk.js';
import { compareTraces } from '../src/shared/trace-diff.js';

// A stand-in workspace with two files, so the lesson needs no real files.
const harness: SdkHarness = {
  snapshot: async () => ({ files: ['notes.txt', 'todo.txt'], digest: '0'.repeat(64) }),
  readFile: async (_run, name) => `the contents of ${name}`,
  prepare: async () => {
    throw new Error('This lesson proposes no edits or commands.');
  },
  decide: () => {},
  execute: async () => {
    throw new Error('This lesson proposes no edits or commands.');
  },
  cancel: () => {},
};

/** Run the same question once, with a scripted model and an agent purpose you choose. */
async function run(id: string, file: string, answer: string, purpose = 'Help the user.') {
  const store = new TraceStore();
  const done = await createSdkAdapter({
    harness,
    model: new ScriptedModel([
      [functionCall('read_file', { path: file }, { callId: 'read-1' })],
      [assistantMessage(answer)],
    ]),
    trace: store,
    webSearchEnabled: false,
    workspaceToolsEnabled: true,
  }).start({
    runId: id,
    prompt: 'What does the notes file say?',
    team: [
      {
        id: 'primary',
        role: 'coordinator',
        name: 'Orbit',
        purpose,
        color: '#567a75',
        shape: 'orbit',
      },
    ],
  });
  assert.equal(done.status, 'completed');
  return store.get(id)!;
}

const baseline = await run('baseline', 'notes.txt', 'It says: the contents of notes.txt.');

// 1. The same moves in different words. A model's wording changes from run to run, so wording
//    alone is never reported as a difference.
const reworded = compareTraces(
  baseline,
  await run('reworded', 'notes.txt', 'The file reads "the contents of notes.txt".'),
);
console.log(`  reworded: ${verdict(reworded)}`);
assert.equal(reworded.firstDivergence, null);

// 2. Change the agent's purpose. It still does the same things, but its instructions differ,
//    which is where a personality lives. The comparison shows the instruction change.
const terse = compareTraces(
  baseline,
  await run('terse', 'notes.txt', 'Done.', 'Answer in one word.'),
);
console.log(
  `  terse: ${verdict(terse)} Instructions ${terse.instructions.same ? 'match' : 'differ'}.`,
);
assert.equal(terse.firstDivergence, null);
assert.equal(terse.instructions.same, false);

// 3. The agent reads a different file. This is a real difference in behavior, and the comparison
//    points at the first call where it happened, with the arguments that differ.
const other = compareTraces(
  baseline,
  await run('other', 'todo.txt', 'It says: the contents of todo.txt.'),
);
console.log(`  other: ${verdict(other)}`);
assert.equal(other.firstDivergence, 1);
assert.deepEqual(
  other.pairs.map((pair) => pair.sameMove),
  [false, true],
  'the runs split at the first call, then both reply',
);

console.log('11. Compare: wording varies, so ask where two runs first did something different.');
console.log('Exercise: make the second run call read_file twice. Where do the runs diverge now?');
