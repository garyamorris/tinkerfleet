/** Per-bot capabilities: profiles narrow the tools the server enables, and never widen them. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { tool, type Tool } from '@openai/agents';
import { ScriptedModel, assistantMessage, functionCall } from '@openai/agents/testing';
import { z } from 'zod';
import { createApp } from '../src/server/app.js';
import { validateParticipants, validateProfiles } from '../src/server/personas.js';
import { createFleetAgents, createSdkAdapter, type SdkHarness } from '../src/server/sdk.js';
import {
  CAPABILITIES,
  canLeakWorkspace,
  createdAgentProblem,
  grantedCapabilities,
  withLibraryLimit,
} from '../src/shared/capabilities.js';
import type { Capability, Persona } from '../src/shared/types.js';

const bot = (
  id: string,
  capabilities?: Capability[],
  role: Persona['role'] = 'agent',
): Persona => ({
  id,
  name: id,
  purpose: `Be ${id}.`,
  role,
  color: '#3a7d82',
  shape: 'orbit',
  ...(capabilities ? { capabilities } : {}),
});
const all = { web: true, workspace: true, memory: true };

test('a profile narrows what the server enables and never widens it', () => {
  assert.deepEqual(grantedCapabilities(bot('legacy'), all), [...CAPABILITIES]);
  assert.deepEqual(grantedCapabilities(bot('scout', ['web', 'memory']), all), ['web', 'memory']);
  assert.deepEqual(grantedCapabilities(bot('none', []), all), []);
  // The server's switches cap every profile, including a legacy one.
  const noWeb = { ...all, web: false },
    noWorkspace = { ...all, workspace: false };
  assert.deepEqual(grantedCapabilities(bot('scout', ['web', 'memory']), noWeb), ['memory']);
  assert.deepEqual(grantedCapabilities(bot('legacy'), noWorkspace), ['web', 'memory']);
  assert.deepEqual(grantedCapabilities(bot('maker', ['read', 'edit', 'run']), noWorkspace), []);
  assert.ok(canLeakWorkspace(['read', 'web']));
  assert.ok(!canLeakWorkspace(['read', 'edit']));
});

test('narrowing a library profile reaches captured copies; widening does not', () => {
  const captured = bot('maker', ['read', 'edit', 'run']);
  assert.deepEqual(withLibraryLimit(captured, [bot('maker', ['read', 'edit'])]).capabilities, [
    'read',
    'edit',
  ]);
  assert.deepEqual(
    withLibraryLimit(captured, [bot('maker', ['read', 'edit', 'run', 'web'])]).capabilities,
    ['read', 'edit', 'run'],
  );
  // A captured legacy copy has every tool, so the library's choice is the limit.
  assert.deepEqual(withLibraryLimit(bot('maker'), [bot('maker', ['read'])]).capabilities, ['read']);
  // No library entry, or a legacy one, changes nothing.
  assert.equal(withLibraryLimit(captured, []), captured);
  assert.equal(withLibraryLimit(captured, [bot('maker')]), captured);
});

test('profile validation stores capabilities in one order and keeps legacy profiles loading', () => {
  const [stored] = validateParticipants([bot('maker', ['memory', 'edit', 'read'])]);
  assert.deepEqual(stored.capabilities, ['read', 'edit', 'memory']);
  assert.ok(Object.isFrozen(stored.capabilities));
  const [legacy] = validateProfiles([bot('old')]);
  assert.equal('capabilities' in legacy, false);
  for (const capabilities of [
    'read',
    ['read', 'read'],
    ['admin'],
    ['read', 'edit', 'run', 'web', 'memory', 'web'],
    [null],
  ])
    assert.throws(() => validateParticipants([{ ...bot('bad'), capabilities }]));
});

test('only a created agent’s safe capabilities pass, and never read with web', () => {
  assert.equal(createdAgentProblem([]), undefined);
  assert.equal(createdAgentProblem(['web', 'memory']), undefined);
  assert.equal(createdAgentProblem(['read', 'memory']), undefined);
  assert.match(createdAgentProblem(['read', 'edit'])!, /cannot start with edit/);
  assert.match(createdAgentProblem(['run'])!, /cannot start with run/);
  assert.match(createdAgentProblem(['read', 'web'])!, /both read and web/);
});

const marker = (name: string): Tool =>
  tool({
    name,
    description: `Marker ${name}.`,
    parameters: z.object({}).strict(),
    execute: async () => name,
  });
const memoryTools = () => [marker('recall_memory')];
const names = (agent: { tools: Tool[] }) => agent.tools.map((t) => t.name);

test('each agent receives only the tools its capabilities allow', () => {
  const fleet = createFleetAgents({
    model: 'offline',
    team: [
      bot('primary', ['read', 'memory'], 'coordinator'),
      bot('scout', ['web', 'memory']),
      bot('maker', ['read', 'edit']),
      bot('checker', ['read', 'run']),
      bot('quiet', []),
      bot('legacy'),
    ],
    webSearchEnabled: true,
    workspaceToolsEnabled: true,
    readTools: [marker('read_file')],
    mutationTools: [marker('edit_file')],
    commandTools: [marker('run_command')],
    memoryTools,
  });
  assert.deepEqual(names(fleet.scout), ['web_search', 'recall_memory']);
  assert.deepEqual(names(fleet.maker), ['read_file', 'edit_file']);
  assert.deepEqual(names(fleet.checker), ['read_file', 'run_command']);
  assert.deepEqual(names(fleet.quiet), []);
  assert.deepEqual(names(fleet.legacy), [
    'read_file',
    'run_command',
    'edit_file',
    'web_search',
    'recall_memory',
  ]);
  // The primary's own tools follow its profile; asking its group members comes with its role.
  assert.deepEqual(names(fleet.coordinator), [
    'read_file',
    'recall_memory',
    'ask_scout',
    'ask_maker',
    'ask_checker',
    'ask_quiet',
    'ask_legacy',
  ]);
  const instructions = (id: string) => String(fleet[id].instructions);
  assert.match(instructions('scout'), /Your capabilities: \["web","memory"\]/);
  assert.match(instructions('scout'), /No workspace:/);
  assert.match(instructions('maker'), /You cannot run commands/);
  assert.match(instructions('maker'), /You have no web search/);
  assert.doesNotMatch(instructions('maker'), /run_command/);
  assert.doesNotMatch(instructions('checker'), /edit_file/);
  assert.match(
    instructions('coordinator'),
    /"id":"checker","name":"checker","capabilities":\["read","run"\]/,
  );
});

test('a profile cannot get tools the server has switched off', () => {
  const fleet = createFleetAgents({
    model: 'offline',
    team: [bot('scout', ['web', 'read', 'edit', 'run', 'memory'])],
    webSearchEnabled: false,
    workspaceToolsEnabled: false,
    readTools: [marker('read_file')],
    mutationTools: [marker('edit_file')],
    commandTools: [marker('run_command')],
  });
  assert.deepEqual(names(fleet.scout), []);
  assert.match(String(fleet.scout.instructions), /Your capabilities: \[\]/);
});

function noHarness(): SdkHarness {
  const fail = async (): Promise<never> => {
    throw new Error('Harness access is not expected.');
  };
  return {
    snapshot: fail,
    readFile: fail,
    prepare: fail,
    decide: () => {
      throw new Error('Harness access is not expected.');
    },
    execute: fail,
    cancel: () => {
      throw new Error('Harness access is not expected.');
    },
  } as unknown as SdkHarness;
}

test('create_agent asks for capabilities and the server refuses edit, run, and read with web', async () => {
  const created: unknown[] = [];
  const request = (capabilities: Capability[]) => ({
    name: 'Ada',
    purpose: 'Explain things patiently.',
    capabilities,
  });
  const model = new ScriptedModel([
    [functionCall('create_agent', request(['read', 'run']), { callId: 'with-run' })],
    [functionCall('create_agent', request(['read', 'web']), { callId: 'read-web' })],
    [functionCall('create_agent', request(['memory', 'web']), { callId: 'safe' })],
    [assistantMessage('Created Ada with web and memory.')],
  ]);
  const done = await createSdkAdapter({
    harness: noHarness(),
    model,
    workspaceToolsEnabled: false,
    createAgent: async (_runId, input) => {
      created.push(input);
      return { ...bot('ada'), ...input };
    },
  }).start({
    runId: 'create-with-capabilities',
    prompt: 'Create Ada.',
    team: [bot('primary', undefined, 'coordinator')],
    availableBots: [],
  });
  assert.equal(done.status, 'completed');
  // Refusals are ordinary results, so the model could try again with fewer capabilities.
  const results = JSON.stringify(model.calls[3].request.input);
  assert.match(results, /cannot start with run/);
  assert.match(results, /both read and web/);
  assert.deepEqual(created, [request(['memory', 'web'])]);
  const tool = model.calls[0].request.tools.find((t) => t.name === 'create_agent');
  assert.match(JSON.stringify(tool), /capabilities/);
  model.assertComplete();
});

test('a server callback cannot return different capabilities than were asked for', async () => {
  const model = new ScriptedModel([
    [
      functionCall(
        'create_agent',
        { name: 'Ada', purpose: 'Explain.', capabilities: ['memory'] },
        { callId: 'forged' },
      ),
    ],
  ]);
  const done = await createSdkAdapter({
    harness: noHarness(),
    model,
    workspaceToolsEnabled: false,
    createAgent: async () => ({
      ...bot('ada', ['memory', 'web']),
      name: 'Ada',
      purpose: 'Explain.',
    }),
  }).start({
    runId: 'forged-capabilities',
    prompt: 'Create Ada.',
    team: [bot('primary', undefined, 'coordinator')],
    availableBots: [],
  });
  assert.equal(done.status, 'error');
  model.assertComplete();
});

async function liveApp(t: test.TestContext, port: number, model: ScriptedModel) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tinkerfleet-capabilities-'));
  const app = createApp({
    port,
    mode: 'live',
    sdkModel: model,
    statePath: path.join(directory, 'state.json'),
    workspaceToolsEnabled: false,
    webSearchEnabled: false,
  });
  await new Promise<void>((resolve) => app.server.listen(port, '127.0.0.1', resolve));
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const session = await fetch(base + '/api/session', { headers: { Connection: 'close' } });
  const { csrf } = (await session.json()) as { csrf: string };
  const headers = {
    Cookie: session.headers.get('set-cookie')!.split(';')[0],
    Origin: base,
    'X-Tinkerfleet-CSRF': csrf,
    'Content-Type': 'application/json',
    Connection: 'close',
  };
  const post = (url: string, body: unknown) =>
    fetch(base + url, { method: 'POST', headers, body: JSON.stringify(body) });
  const settle = async () => {
    for (let i = 0; i < 200 && app.state().runs.some((r) => r.status === 'running'); i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
  };
  return { app, post, settle };
}

test('the profile API saves capabilities and rejects invalid ones', async (t) => {
  const { post } = await liveApp(t, 45361, new ScriptedModel([]));
  const saved = await post('/api/profiles', {
    name: 'Scout',
    purpose: 'Search the web.',
    capabilities: ['memory', 'web'],
  });
  assert.equal(saved.status, 201);
  const scout = (await saved.json()) as Persona;
  assert.deepEqual(scout.capabilities, ['web', 'memory']);
  const narrowed = await post(`/api/profiles/${scout.id}`, { capabilities: [] });
  assert.deepEqual(((await narrowed.json()) as Persona).capabilities, []);
  for (const capabilities of [['sudo'], 'web', ['web', 'web']])
    assert.equal(
      (await post(`/api/profiles/${scout.id}`, { capabilities })).status,
      400,
      JSON.stringify(capabilities),
    );
  // A profile created without the field keeps today's behavior.
  const legacy = (await (
    await post('/api/profiles', { name: 'Old', purpose: 'Be old.' })
  ).json()) as Persona;
  assert.equal(legacy.capabilities, undefined);
});

test('removing a capability in the library applies to an existing conversation', async (t) => {
  const model = new ScriptedModel([[assistantMessage('First.')], [assistantMessage('Second.')]]);
  const { app, post, settle } = await liveApp(t, 45362, model);
  const nova = (await (
    await post('/api/profiles', {
      name: 'Nova',
      purpose: 'Remember things.',
      capabilities: ['memory'],
    })
  ).json()) as Persona;
  const chat = (await (await post('/api/conversations', { participants: [nova] })).json()) as {
    id: string;
  };
  assert.equal((await post(`/api/conversations/${chat.id}/runs`, { prompt: 'Hi' })).status, 201);
  await settle();
  assert.deepEqual(
    model.calls[0].request.tools.map((t) => t.name),
    ['recall_memory', 'remember_memory', 'forget_memory'],
  );
  assert.equal((await post(`/api/profiles/${nova.id}`, { capabilities: [] })).status, 200);
  assert.equal((await post(`/api/conversations/${chat.id}/runs`, { prompt: 'Hi' })).status, 201);
  await settle();
  assert.deepEqual(model.calls[1].request.tools, []);
  // The conversation still shows the profile it captured.
  assert.deepEqual(
    app.state().conversations.find((c) => c.id === chat.id)!.participants[0].capabilities,
    ['memory'],
  );
  model.assertComplete();
});

test('a primary-created agent is saved with the capabilities it asked for', async (t) => {
  const model = new ScriptedModel([
    [
      functionCall(
        'create_agent',
        { name: 'Ada', purpose: 'Explain.', capabilities: ['memory'] },
        { callId: 'ok' },
      ),
    ],
    [assistantMessage('Done.')],
  ]);
  const { app, post, settle } = await liveApp(t, 45363, model);
  const primary = (await (
    await post('/api/profiles', { name: 'Orbit', purpose: 'Coordinate.', role: 'coordinator' })
  ).json()) as Persona;
  const chat = (await (
    await post('/api/conversations', { participants: [primary], availableBots: [] })
  ).json()) as { id: string };
  assert.equal(
    (await post(`/api/conversations/${chat.id}/runs`, { prompt: 'Create' })).status,
    201,
  );
  await settle();
  const ada = app.state().profiles.find((p) => p.name === 'Ada')!;
  assert.deepEqual(ada.capabilities, ['memory']);
  model.assertComplete();
});
