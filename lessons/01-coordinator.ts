/** Lesson 1: construct a primary agent without making a model request. */
import assert from 'node:assert/strict';
import { createFleetAgents } from '../src/server/sdk.js';

// Constructing an Agent is configuration, not inference.
const { coordinator } = createFleetAgents({
  model: 'lesson-no-inference',
  team: [{ id: 'primary', role: 'coordinator', name: 'Orbit',
    purpose: 'Help the user and coordinate when useful.', color: '#567a75', shape: 'orbit' }],
});
assert.ok(coordinator);
assert.equal(typeof coordinator.instructions, 'string');
assert.match(String(coordinator.instructions), /retain responsibility/i);
assert.equal(coordinator.handoffs.length, 0);
// No tools were supplied: personality text cannot manufacture capabilities.
assert.equal(coordinator.tools.length, 0);

console.log('1. Primary agent: one task owner, explicit tools, zero model calls.');
console.log('Exercise: why does naming an agent Orbit not grant filesystem access?');
