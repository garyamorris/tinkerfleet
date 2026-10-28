import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starterPrompts } from '../src/client/starters';
import type { Persona } from '../src/shared/types';

const bot = (over: Partial<Persona>): Persona => ({
  id: 'nova',
  name: 'Nova',
  purpose: 'A patient astronomy tutor.',
  role: 'agent',
  color: '#3978b8',
  shape: 'orbit',
  ...over,
});

test('a demo bot is only offered requests its own tools can carry out', () => {
  const chatOnly = starterPrompts(bot({}), 'demo', ['memory'], []);
  assert.deepEqual(chatOnly, ['Hello!']);
  assert.ok(!chatOnly.some((p) => /tiny-project/.test(p)));
  const checker = starterPrompts(bot({ name: 'Checker' }), 'demo', ['read', 'run', 'memory'], []);
  assert.deepEqual(checker, [
    'Inspect sum.js in tiny-project.',
    'Verify the tests in tiny-project.',
    'Hello!',
  ]);
});

test('the demo primary is offered the scripted group, creation and message examples', () => {
  const orbit = bot({ id: 'orbit', name: 'Orbit', role: 'coordinator' });
  const prompts = starterPrompts(orbit, 'demo', ['read', 'memory'], [orbit, bot({})]);
  assert.deepEqual(prompts, [
    'Help me fix the failing tests in tiny-project.',
    'Create a patient astronomy tutor called Nova.',
    'Ask Nova: Hello',
  ]);
});

test('live prompts follow capabilities and stop at three', () => {
  const prompts = starterPrompts(bot({}), 'live', ['web', 'read', 'run', 'memory'], []);
  assert.equal(prompts.length, 3);
  assert.match(prompts[0], /Cite your sources/);
  assert.deepEqual(starterPrompts(bot({}), 'live', [], []), [
    'Introduce yourself and tell me how you can help.',
  ]);
});
