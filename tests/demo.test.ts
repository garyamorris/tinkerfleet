import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApprovalStore } from '../src/server/approval.js';
import { DemoModel, createDemoWorkspace } from '../src/server/demo.js';
import { NativeWorkspaceRunner } from '../src/server/native-runner.js';
import {
  createSdkAdapter,
  type SdkAdapterOptions,
  type SdkEvent,
  type SdkHarness,
  type SdkStatus,
} from '../src/server/sdk.js';
import type { Persona } from '../src/shared/types.js';
import { customTeam } from './personas.fixture.js';

// The demo model drives the real adapter, approval store and native runner on a
// temporary copy of tiny-project, exactly as the app does in demo mode.
function demoAdapter(t: test.TestContext, extra: Partial<SdkAdapterOptions> = {}) {
  const root = createDemoWorkspace();
  const approvals = new ApprovalStore();
  const runner = new NativeWorkspaceRunner({ workspaceRoot: root, approvals });
  t.after(async () => {
    await runner.shutdown();
    await rm(root, { recursive: true, force: true });
  });
  const harness: SdkHarness = {
    snapshot: (id) => runner.snapshot(id),
    readFile: (id, name) => runner.readFile(id, name),
    prepare: (id, action) => runner.prepare(id, action),
    decide: (id, approvalId, digest, approved) =>
      approvals.decide(id, approvalId, digest, approved),
    execute: (id, approvalId, options) => runner.execute(id, approvalId, options),
    cancel: (id) => runner.cancel(id),
  };
  const events: SdkEvent[] = [];
  const adapter = createSdkAdapter({
    harness,
    model: new DemoModel(0),
    workspaceRoot: root,
    onEvent: (event) => events.push(event),
    ...extra,
  });
  const sumJs = () => readFile(path.join(root, 'sum.js'), 'utf8');
  return { adapter, root, events, sumJs };
}

// Purposes contain sentences, quotes and brackets, as real profiles do.
const agent = (id: string, name: string): Persona => ({
  id,
  name,
  purpose: `Help as ${name}. Reads "notes" [carefully]. Keeps it short.`,
  role: 'agent',
  color: '#3a7d82',
  shape: 'orbit',
});
const primary: Persona = { ...agent('primary', 'Orbit'), role: 'coordinator' };
const lastMessage = (events: SdkEvent[]) =>
  events.filter((event) => event.type === 'agent_message').at(-1)?.message ?? '';

async function approveAll(
  adapter: ReturnType<typeof createSdkAdapter>,
  status: SdkStatus,
  approved = true,
) {
  const seen: SdkStatus[] = [];
  while (status.status === 'awaiting_approval') {
    seen.push(status);
    const pending = status.pendingApprovals[0];
    status = await adapter.resume({
      runId: status.runId,
      approvalId: pending.approvalId,
      digest: pending.digest,
      approved,
    });
  }
  return { final: status, paused: seen };
}

test('createDemoWorkspace copies the broken fixture to a fresh folder', async (t) => {
  const root = createDemoWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = fileURLToPath(new URL('../examples/tiny-project', import.meta.url));
  assert.notEqual(root, fixture);
  assert.match(await readFile(path.join(root, 'sum.js'), 'utf8'), /return a - b;/);
});

test('a direct agent reads, then edits and tests only after each exact approval', async (t) => {
  const { adapter, sumJs, events } = demoAdapter(t);
  const paused = await adapter.start({
    runId: 'direct-fix',
    prompt: 'Fix the failing tests in tiny-project.',
    team: [agent('nova', 'Nova')],
  });
  assert.equal(paused.status, 'awaiting_approval');
  assert.deepEqual(paused.pendingApprovals[0].action, {
    kind: 'edit',
    path: 'sum.js',
    content: (await sumJs()).replace('return a - b;', 'return a + b;'),
  });
  assert.match(await sumJs(), /a - b/, 'nothing is written before approval');
  assert.ok(events.some((e) => e.type === 'tool_finished' && e.tool === 'read_file'));

  const { final, paused: steps } = await approveAll(adapter, paused);
  assert.equal(steps.length, 2);
  assert.deepEqual(steps[1].pendingApprovals[0].action, {
    kind: 'command',
    executable: 'node',
    args: ['--test', 'sum.test.js'],
  });
  assert.equal(final.status, 'completed', JSON.stringify(final));
  assert.match(await sumJs(), /return a \+ b;/);
  assert.match(final.output ?? '', /3 passed and 0 failed/);
});

test('declining the edit leaves the file unchanged and the agent says so', async (t) => {
  const { adapter, sumJs } = demoAdapter(t);
  const paused = await adapter.start({
    runId: 'declined',
    prompt: 'Fix the failing tests in tiny-project.',
    team: [agent('nova', 'Nova')],
  });
  const { final, paused: steps } = await approveAll(adapter, paused, false);
  assert.equal(steps.length, 1, 'no command is proposed after a declined edit');
  assert.equal(final.status, 'completed');
  assert.match(final.output ?? '', /declined the edit/);
  assert.match(await sumJs(), /return a - b;/);
});

test('greetings and questions use no tools', async (t) => {
  const { adapter, events } = demoAdapter(t);
  for (const prompt of ['Hello', 'What can you do?']) {
    const done = await adapter.start({
      runId: `chat-${prompt.length}`,
      prompt,
      team: [agent('nova', 'Nova')],
    });
    assert.equal(done.status, 'completed');
    assert.match(
      done.output ?? '',
      /Hello from Nova\. This reply comes from the scripted demo model/,
    );
  }
  assert.equal(events.filter((e) => e.type === 'tool_started').length, 0);
});

test('the primary agent creates, messages and groups agents through its real tools', async (t) => {
  const calls: { tool: string; request: unknown }[] = [];
  const nova = agent('nova', 'Nova');
  const ada = agent('ada', 'Ada');
  const { adapter } = demoAdapter(t, {
    createAgent: async (_runId, request) => {
      calls.push({ tool: 'create_agent', request });
      return { ...agent('nova-2', request.name), purpose: request.purpose };
    },
    messageAgent: async (_runId, request) => {
      calls.push({ tool: 'message_agent', request });
      return { agentId: request.agentId, conversationId: 'direct-chat' };
    },
    startGroup: async (_runId, request) => {
      calls.push({ tool: 'start_group_conversation', request });
      return { conversationId: 'group-chat', title: request.title };
    },
  });
  const run = (runId: string, prompt: string, availableBots: Persona[] = [nova, ada]) =>
    adapter.start({ runId, prompt, team: [primary], availableBots });

  const created = await run('create', 'Create a patient astronomy tutor called Stella.');
  assert.match(created.output ?? '', /I saved Stella to your bot library/);
  const asked = await run('ask', 'Ask Nova: What is a light year?');
  assert.match(asked.output ?? '', /sent your message to Nova/);
  const unknown = await run('ask-unknown', 'Ask Zed: Hello');
  assert.match(unknown.output ?? '', /could not find exactly one agent/);
  const grouped = await run('group', 'Fix the failing tests in tiny-project.');
  assert.match(grouped.output ?? '', /started a group conversation/);

  assert.deepEqual(calls, [
    {
      tool: 'create_agent',
      request: { name: 'Stella', purpose: 'Act as a patient astronomy tutor.' },
    },
    { tool: 'message_agent', request: { agentId: 'nova', message: 'What is a light year?' } },
    {
      tool: 'start_group_conversation',
      request: {
        title: 'Tiny-project repair',
        brief:
          'Fix the failing addition tests in tiny-project. Inspect sum.js, make the smallest fix, and verify it by running the tests.',
        botIds: ['nova', 'ada'],
      },
    },
  ]);
});

test('the primary does the work itself when asked not to use a group', async (t) => {
  const { adapter } = demoAdapter(t, {
    startGroup: async () => assert.fail('no group should start'),
  });
  const paused = await adapter.start({
    runId: 'direct-primary',
    prompt: 'Fix the failing tests in tiny-project without a group.',
    team: [primary],
    availableBots: [agent('nova', 'Nova')],
  });
  assert.equal(paused.pendingApprovals[0].agent, 'coordinator');
  assert.equal((await approveAll(adapter, paused)).final.status, 'completed');
});

test('a group lead delegates inspect, fix and verify to members in order, keeping identities', async (t) => {
  const { adapter, events, sumJs } = demoAdapter(t);
  const team = customTeam();
  const paused = await adapter.start({ runId: 'group', prompt: 'Fix tiny-project', team });
  team[1].name = 'Later change';
  const { final, paused: steps } = await approveAll(adapter, paused);
  assert.deepEqual(
    steps.map((s) => s.pendingApprovals[0].agent),
    ['custom-maker', 'custom-checker'],
  );
  assert.equal(final.status, 'completed', JSON.stringify(final));
  assert.match(
    lastMessage(events),
    /Bot 2 inspected sum\.js, Bot 3 fixed it, and Bot 4 ran the tests: 3 passed and 0 failed/,
  );
  assert.match(await sumJs(), /return a \+ b;/);
  assert.doesNotMatch(JSON.stringify(events), /Later change/);
});
