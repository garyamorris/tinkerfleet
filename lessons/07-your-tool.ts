/** Lesson 7: give the app's agents a tool of your own, and watch the primary agent use it. */
import assert from 'node:assert/strict';
import { Runner, tool } from '@openai/agents';
import { ScriptedModel, assistantMessage, functionCall } from '@openai/agents/testing';
import { z } from 'zod';
import { createFleetAgents } from '../src/server/sdk.js';

// A stand-in for the workspace, so the lesson needs no files.
const files: Record<string, string> = { 'notes.txt': 'one\n\ntwo\n' };

// Your tool: a name, a description the model reads, an input schema, and code.
const countLines = tool({
  name: 'count_lines',
  description: 'Count the nonempty lines in a text file in the selected workspace.',
  parameters: z.object({ path: z.string().describe('Path relative to the workspace.') }),
  execute: async ({ path }) => {
    const text = files[path];
    if (text === undefined) throw new Error(`No file named ${path}.`);
    return String(text.split('\n').filter((line) => line.trim()).length);
  },
});

// The app's real factory builds the primary agent, with your tool among its read tools.
const model = new ScriptedModel([
  [functionCall('count_lines', { path: 'notes.txt' }, { callId: 'count-1' })],
  [assistantMessage('notes.txt has 2 nonempty lines.')],
]);
const { coordinator } = createFleetAgents({
  model,
  readTools: [countLines],
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
const result = await new Runner({ tracingDisabled: true }).run(
  coordinator,
  'How many lines are in notes.txt?',
);

// What the model was offered: your tool's name, description and JSON Schema.
const offered = model.calls[0].request.tools?.find(
  (t) => 'name' in t && t.name === 'count_lines',
) as { description?: string; parameters?: { properties?: object } } | undefined;
assert.ok(offered, 'the model was offered count_lines');
assert.equal(offered.description, countLines.description);
assert.deepEqual(Object.keys(offered.parameters?.properties ?? {}), ['path']);
console.log(`  offered to the model: count_lines — ${offered.description}`);

// What came back: your code's result, sent to the model on its next call.
const second = model.calls[1].request.input as { type: string; output?: { text?: string } }[];
assert.equal(second.at(-1)?.output?.text, '2');
assert.equal(result.finalOutput, 'notes.txt has 2 nonempty lines.');
console.log(`  your tool returned "2"; the model answered: ${result.finalOutput}`);

console.log('7. Your tool: the model saw its description and schema, and your code did the work.');
console.log(
  'Exercise: script a call for missing.txt. Your tool throws; what text does the model receive?',
);
