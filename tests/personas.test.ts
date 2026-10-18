import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateParticipants, validateTeam } from '../src/server/personas.js';
import { customTeam } from './personas.fixture.js';

test('teams are bounded, normalized, detached, and immutable with one bot per capability role', () => {
  const original = customTeam();
  original[0].name = '  Captain  ';
  const team = validateTeam(original)!;
  assert.equal(team[0].name, 'Captain');
  original[0].purpose = 'changed';
  original.reverse();
  assert.equal(team[0].purpose, 'Focus on coordinator clarity.');
  assert.equal(team[0].role, 'coordinator');
  assert.ok(Object.isFrozen(team) && team.every(Object.isFrozen));
  assert.throws(() => {
    team[0].name = 'changed';
  });
  assert.equal(validateTeam(undefined), undefined);
});

test('malformed teams and credential-like customization cannot enter a run', () => {
  const invalid: unknown[] = [
    null,
    {},
    [],
    customTeam().slice(0, 3),
    [...customTeam(), customTeam()[0]],
  ];
  for (const patch of [
    { id: '../bad' },
    { id: 'x'.repeat(65) },
    { name: ' ' },
    { name: 'x'.repeat(41) },
    { purpose: 'x'.repeat(601) },
    { name: 'line\ncontrol' },
    { purpose: 'null\u0000control' },
    { purpose: 'escape\u001bcontrol' },
    { purpose: 'sk-' + 'a'.repeat(40) },
    { name: 'Bearer ' + 'a'.repeat(40) },
    { color: 'url(https://example.com)' },
    { shape: 'script' },
    { shape: ['orbit'] },
    { role: 'admin' },
    { tools: ['shell'] },
  ]) {
    const team = customTeam();
    invalid.push([{ ...team[0], ...patch }, ...team.slice(1)]);
  }
  const duplicateRole = customTeam();
  duplicateRole[1].role = 'coordinator';
  invalid.push(duplicateRole);
  const duplicateId = customTeam();
  duplicateId[1].id = duplicateId[0].id;
  invalid.push(duplicateId);
  for (const value of invalid) assert.throws(() => validateTeam(value));
});

test('run history keeps the profiles assigned when the run started', () => {
  const team = customTeam();
  const first = validateParticipants(team);
  team[0].name = 'Replacement';
  const second = validateParticipants(team);
  assert.equal(first[0].name, 'Bot 1');
  assert.equal(second[0].name, 'Replacement');
  assert.ok(Object.isFrozen(first));
});

test('multiline purpose preserves ordinary instruction formatting without relaxing control filtering', () => {
  const team = customTeam();
  team[1].purpose = 'Inspect first.\n\tReport findings.\r\nKeep changes small.';
  assert.equal(validateTeam(team)![1].purpose, team[1].purpose);
});

test('ordinary personalities share a role and are selected by unique IDs up to eight participants', async () => {
  const { validateParticipants, validateAvailableBots } = await import('../src/server/personas.js');
  const primary = customTeam()[0];
  const agents = Array.from({ length: 7 }, (_, i) => ({
    ...customTeam()[1],
    id: `personality-${i}`,
    role: 'agent' as const,
    name: `Personality ${i}`,
  }));
  assert.equal(validateParticipants([primary, ...agents]).length, 8);
  assert.equal(validateAvailableBots(agents).length, 7);
  assert.throws(() => validateParticipants([primary, ...agents, { ...agents[0], id: 'ninth' }]));
  assert.throws(() => validateParticipants([agents[0], agents[0]]));
  assert.throws(() => validateParticipants([{ ...agents[0], id: 'coordinator' }]));
  assert.throws(() => validateParticipants([primary, { ...primary, id: 'other-primary' }]));
});

test('new random appearances are valid, rerolls change the pair, and existing avatars are untouched', async () => {
  const { randomAppearance } = await import('../src/shared/appearance.js');
  const { validateParticipants } = await import('../src/server/personas.js');
  const saved = { color: '#1266aa', shape: 'orbit' as const },
    original = { ...saved };
  let appearance = randomAppearance(saved);
  for (let i = 0; i < 100; i++) {
    assert.match(appearance.color, /^#[0-9a-f]{6}$/);
    assert.ok(['orbit', 'spark', 'pebble', 'gem'].includes(appearance.shape));
    assert.equal(validateParticipants([{ ...customTeam()[1], ...appearance }]).length, 1);
    const next = randomAppearance(appearance);
    assert.notDeepEqual(next, appearance);
    appearance = next;
  }
  assert.deepEqual(saved, original);
  const uppercase = { ...appearance, color: appearance.color.toUpperCase() };
  const next = randomAppearance(uppercase);
  assert.ok(next.color !== appearance.color || next.shape !== appearance.shape);
});
