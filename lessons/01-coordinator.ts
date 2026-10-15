/** Lesson 1: construct the real coordinator without making a model request. */
import assert from 'node:assert/strict';
import { createFleetAgents } from '../src/server/sdk.js';

// A model name is configuration. Constructing an Agent does not call that model.
// This intentionally non-runnable name makes the lesson's intent obvious.
const { coordinator } = createFleetAgents({ model: 'lesson-no-inference' });
assert.equal(coordinator.name, 'Coordinator');
assert.equal(typeof coordinator.instructions, 'string');
assert.match(String(coordinator.instructions), /retain responsibility/i);
assert.equal(coordinator.handoffs.length, 0);
assert.deepEqual(
  coordinator.tools.map(t => t.type === 'function' ? t.name : t.type),
  ['ask_scout', 'ask_maker', 'ask_checker'],
);

console.log('1. Coordinator: one task owner, three delegation tools, zero model calls.');
console.log('Exercise: inspect createFleetAgents. Why is a role instruction not a permission check?');
