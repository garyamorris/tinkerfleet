/** Lesson 2: inspect real agents-as-tools and server-owned tool assignment. */
import assert from 'node:assert/strict';
import { tool } from '@openai/agents';
import { z } from 'zod';
import { createFleetAgents } from '../src/server/sdk.js';

// These lesson-only tool implementations are never invoked. There is no inference.
const read = tool({
  name: 'lesson_read', description: 'Read a synthetic lesson fixture.',
  parameters: z.object({ path: z.string() }),
  execute: async () => 'Synthetic fixture',
});
const propose = tool({
  name: 'lesson_propose', description: 'A lesson action that requires review.',
  parameters: z.object({ path: z.string() }), needsApproval: true,
  execute: async () => 'Synthetic result',
});
const fleet = createFleetAgents({
  model: 'lesson-no-inference', readTools: [read], mutationTools: [propose],
});
assert.deepEqual(fleet.scout.tools, [read]);
assert.deepEqual(fleet.maker.tools, [read, propose]);
assert.deepEqual(fleet.checker.tools, [read, propose]);
assert.equal(fleet.coordinator.tools.length, 3);
assert.ok(fleet.coordinator.tools.every(t => t.type === 'function'));
assert.equal(fleet.coordinator.handoffs.length, 0);

// The asTool wrapper is a callable tool contract. We inspect it, never invoke it.
const scoutTool = fleet.scout.asTool({
  toolName: 'lesson_ask_scout', toolDescription: 'Return findings to the caller.',
});
assert.equal(scoutTool.name, 'lesson_ask_scout');
assert.equal(scoutTool.type, 'function');
assert.equal(typeof scoutTool.invoke, 'function');

console.log('2. Specialists: Scout is read-only; Maker and Checker get explicit action tools.');
console.log('No tools or models were invoked. An asTool result returns to the coordinator.');
console.log('Exercise: remove the action tool from Checker. Can renaming its avatar restore it?');
