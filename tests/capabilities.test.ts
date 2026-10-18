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
  splitCreatedCapabilities,
  grantedCapabilities,
  withLibraryCapabilities,
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

test('the library’s current capabilities apply to captured copies in both directions', () => {
  const captured = bot('maker', ['read', 'edit', 'run']);
  assert.deepEqual(
    withLibraryCapabilities(captured, [bot('maker', ['read', 'edit'])]).capabilities,
    ['read', 'edit'],
  );
  assert.deepEqual(
    withLibraryCapabilities(captured, [bot('maker', ['read', 'web'])]).capabilities,
    ['read', 'web'],
  );
  // A legacy library entry means every enabled tool, so the captured list is dropped too.
  assert.equal('capabilities' in withLibraryCapabilities(captured, [bot('maker')]), false);
  // Only capabilities follow the library; the captured name and purpose stay.
  const renamed = { ...bot('maker', ['read']), name: 'Renamed', purpose: 'Changed.' };
  assert.equal(withLibraryCapabilities(captured, [renamed]).name, 'maker');
  // A bot deleted from the library keeps what it was captured with.
  assert.equal(withLibraryCapabilities(captured, []), captured);
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

test('a created agent starts with web, read or memory; the rest waits for the user', () => {
  assert.deepEqual(splitCreatedCapabilities([]), { granted: [], needsUser: [] });
  assert.deepEqual(splitCreatedCapabilities(['memory', 'web']), {
    granted: ['web', 'memory'],
    needsUser: [],
  });
  assert.deepEqual(splitCreatedCapabilities(['run', 'read', 'edit']), {
    granted: ['read'],
    needsUser: ['edit', 'run'],
  });
  // Read and web together can leak files, so web waits when read is also asked for.
  assert.deepEqual(splitCreatedCapabilities(['read', 'web', 'memory']), {
    granted: ['read', 'memory'],
    needsUser: ['web'],
  });
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

test('create_agent creates the bot with its safe capabilities and reports what waits', async () => {
  const created: unknown[] = [];
  const request = { name: 'Ada', purpose: 'Run the tests.', capabilities: ['run', 'read'] };
  const model = new ScriptedModel([
    [functionCall('create_agent', request, { callId: 'with-run' })],
    [assistantMessage('Created Ada; run waits for you.')],
  ]);
  const done = await createSdkAdapter({
    harness: noHarness(),
    model,
    workspaceToolsEnabled: false,
    createAgent: async (_runId, input) => {
      created.push(input);
      // The server stores only what it grants now.
      return { ...bot('ada'), name: input.name, purpose: input.purpose, capabilities: ['read'] };
    },
  }).start({
    runId: 'create-with-capabilities',
    prompt: 'Create Ada.',
    team: [bot('primary', undefined, 'coordinator')],
    availableBots: [],
  });
  assert.equal(done.status, 'completed');
  assert.deepEqual(created, [request]);
  const result = JSON.stringify(model.calls[1].request.input);
  assert.match(result, /\\"capabilities\\":\[\\"read\\"\]/);
  assert.match(result, /\\"waitingForUser\\":\[\\"run\\"\]/);
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

async function liveApp(
  t: test.TestContext,
  port: number,
  model: ScriptedModel,
  webSearchEnabled = false,
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tinkerfleet-capabilities-'));
  const app = createApp({
    port,
    mode: 'live',
    sdkModel: model,
    statePath: path.join(directory, 'state.json'),
    workspaceToolsEnabled: false,
    webSearchEnabled,
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
  return { app, post, settle, statePath: path.join(directory, 'state.json') };
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

test('a created bot gets the rest of what it asked for only when the user grants it', async (t) => {
  const model = new ScriptedModel([
    [
      functionCall(
        'create_agent',
        { name: 'Ada', purpose: 'Research.', capabilities: ['web', 'read', 'memory'] },
        { callId: 'create-ada' },
      ),
    ],
    [assistantMessage('Created Ada; web waits for you.')],
    [assistantMessage('Before the grant.')],
    [assistantMessage('After the grant.')],
  ]);
  const { app, post, settle, statePath } = await liveApp(t, 45363, model, true);
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
  assert.deepEqual(ada.capabilities, ['read', 'memory']);
  const creation = app
    .state()
    .runs.flatMap((r) => r.messages)
    .find((m) => m.createdAgentId === ada.id)!;
  assert.deepEqual(creation.requestedCapabilities, ['web']);

  // Ada's own chat, before and after the user grants web from the creation message.
  const hasWeb = (call: number) =>
    model.calls[call].request.tools.some((tool) => JSON.stringify(tool).includes('web_search'));
  const ask = async () => {
    assert.equal(
      (await post(`/api/conversations/${creation.conversationId}/runs`, { prompt: 'Hi' })).status,
      201,
    );
    await settle();
  };
  await ask();
  assert.equal(hasWeb(2), false);
  const granted = await post(`/api/profiles/${ada.id}`, {
    capabilities: ['web', 'read', 'memory'],
  });
  assert.equal(granted.status, 200);
  await ask();
  assert.equal(hasWeb(3), true);

  // The request survives a restart of the saved history.
  const { ConversationStore } = await import('../src/server/conversations.js');
  const saved = new ConversationStore(statePath).state.runs
    .flatMap((r) => r.messages)
    .find((m) => m.createdAgentId === ada.id)!;
  assert.deepEqual(saved.requestedCapabilities, ['web']);
  model.assertComplete();
});
