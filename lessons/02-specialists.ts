/** Lesson 2: named personalities share enabled tools; coordination is explicit. */
import assert from 'node:assert/strict';
import { tool } from '@openai/agents';
import { z } from 'zod';
import { createFleetAgents } from '../src/server/sdk.js';

// These synthetic implementations are never invoked.
const read = tool({
  name: 'lesson_read',
  description: 'Read a synthetic fixture.',
  parameters: z.object({ path: z.string() }),
  execute: async () => 'Synthetic fixture',
});
const propose = tool({
  name: 'lesson_propose',
  description: 'Propose an action for review.',
  parameters: z.object({ path: z.string() }),
  needsApproval: true,
  execute: async () => 'Synthetic result',
});
const fleet = createFleetAgents({
  model: 'lesson-no-inference',
  readTools: [read],
  mutationTools: [propose],
  team: [
    {
      id: 'primary',
      role: 'coordinator',
      name: 'Orbit',
      purpose: 'Coordinate clearly.',
      color: '#567a75',
      shape: 'orbit',
    },
    {
      id: 'ada',
      role: 'agent',
      name: 'Ada',
      purpose: 'Teach patiently.',
      color: '#567a75',
      shape: 'spark',
    },
    {
      id: 'quill',
      role: 'agent',
      name: 'Quill',
      purpose: 'Explain concisely.',
      color: '#567a75',
      shape: 'pebble',
    },
  ],
});
assert.deepEqual(fleet.ada.tools, [read, propose]);
assert.deepEqual(fleet.quill.tools, [read, propose]);
assert.ok(fleet.coordinator.tools.includes(read));
assert.ok(fleet.coordinator.tools.includes(propose));
assert.deepEqual(
  fleet.coordinator.tools
    .filter((t) => t.type === 'function' && t.name.startsWith('ask_'))
    .map((t) => t.name),
  ['ask_ada', 'ask_quill'],
);
assert.equal(fleet.coordinator.handoffs.length, 0);
const askAda = fleet.ada.asTool({
  toolName: 'lesson_ask_ada',
  toolDescription: 'Return an explanation.',
});
assert.equal(askAda.type, 'function');
assert.equal(typeof askAda.invoke, 'function');

console.log('2. Ada and Quill: different personalities, the same enabled tools.');
console.log('The primary can act directly or delegate; approvals still gate actions.');
console.log(
  'No models or tools were invoked. Exercise: does changing a purpose alter tool authority?',
);
