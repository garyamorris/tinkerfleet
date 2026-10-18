import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { Usage, type ModelRequest, type ModelResponse } from '@openai/agents';
import { ScriptedModel, assistantMessage, functionCall, modelError } from '@openai/agents/testing';
import { createApp } from '../src/server/app.js';
import {
  TRACE_LIMITS,
  TraceStore,
  createSdkAdapter,
  type SdkHarness,
  type SdkMemory,
} from '../src/server/sdk.js';
import { summarizeCall, summarizeItem, summarizeTools } from '../src/server/sdk/trace.js';
import type { Persona, RunTrace, TraceCall, TraceItem } from '../src/shared/types.js';

const orbit: Persona = {
  id: 'orbit-profile',
  name: 'Orbit',
  purpose: 'Keep the plan and talk to the user.',
  role: 'coordinator',
  color: '#3a7d82',
  shape: 'orbit',
};
const noWorkspace: SdkHarness = {
  snapshot: async () => {
    throw new Error('The trace tests never touch the workspace.');
  },
  readFile: async () => {
    throw new Error('The trace tests never touch the workspace.');
  },
  prepare: async () => {
    throw new Error('The trace tests never touch the workspace.');
  },
  decide: () => {
    throw new Error('The trace tests never touch the workspace.');
  },
  execute: async () => {
    throw new Error('The trace tests never touch the workspace.');
  },
  cancel: () => {},
};
function memoryWith(text?: string): SdkMemory {
  const entries = text
    ? [{ id: 'memory-1', agentId: orbit.id, text, createdAt: 1, updatedAt: 1 }]
    : [];
  return {
    list: () => structuredClone(entries),
    remember: async (agentId, value) => ({
      id: 'memory-2',
      agentId,
      text: value,
      createdAt: 1,
      updatedAt: 1,
    }),
    forget: async () => false,
  };
}
const adapterFor = (model: ScriptedModel, trace: TraceStore, memory = memoryWith()) =>
  createSdkAdapter({
    harness: noWorkspace,
    model,
    memory,
    workspaceToolsEnabled: false,
    webSearchEnabled: false,
    trace,
  });

test('each kind of request and response item is described, and reasoning is counted but never copied', () => {
  assert.deepEqual(summarizeItem({ type: 'message', role: 'user', content: 'Hi' }), {
    kind: 'user',
    text: 'Hi',
    chars: 2,
  });
  assert.deepEqual(summarizeItem({ role: 'developer', content: 'Be brief.' }).kind, 'system');
  assert.deepEqual(
    summarizeItem({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Hello' }],
    }),
    { kind: 'assistant', text: 'Hello', chars: 5 },
  );
  assert.deepEqual(
    summarizeItem({ type: 'function_call', name: 'read_file', arguments: '{"path":"a.js"}' }),
    { kind: 'tool_call', name: 'read_file', text: '{"path":"a.js"}', chars: 15 },
  );
  assert.deepEqual(
    summarizeItem({
      type: 'function_call_result',
      name: 'read_file',
      output: { type: 'text', text: 'file body' },
    }),
    { kind: 'tool_result', name: 'read_file', text: 'file body', chars: 9 },
  );
  assert.equal(
    summarizeItem({ type: 'function_call_result', name: 'x', output: 'plain' }).text,
    'plain',
  );
  assert.equal(
    summarizeItem({ type: 'function_call_result', name: 'x', output: { stdout: 'ok', stderr: '' } })
      .text,
    'ok',
  );
  const reasoning = summarizeItem({
    type: 'reasoning',
    content: [{ type: 'input_text', text: 'PRIVATE THOUGHTS' }],
    providerData: { encryptedContent: 'OPAQUE' },
  });
  assert.deepEqual(reasoning, { kind: 'reasoning', chars: 0 });
  assert.deepEqual(
    summarizeItem({
      type: 'hosted_tool_call',
      name: 'web_search_call',
      providerData: { action: { type: 'search', query: 'node lts' } },
    }),
    { kind: 'hosted_tool', name: 'web_search_call', text: 'node lts', chars: 8 },
  );
  assert.deepEqual(summarizeItem({ type: 'mystery' }), {
    kind: 'other',
    name: 'mystery',
    chars: 0,
  });
  assert.deepEqual(summarizeItem(null), { kind: 'other', chars: 0 });
});

test('trace text is redacted before it is shortened, and shortening reports the full length', () => {
  const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
  const redacted = summarizeItem({ role: 'user', content: `my key is ${secret}` });
  assert.ok(!redacted.text!.includes(secret));
  assert.match(redacted.text!, /\[REDACTED\]/);

  const long = summarizeItem({ role: 'user', content: 'x'.repeat(5_000) });
  assert.equal(long.text!.length, TRACE_LIMITS.itemChars);
  assert.equal(long.chars, 5_000);

  // A secret that straddles the limit must not leave a readable fragment behind.
  const straddle = summarizeItem({
    role: 'user',
    content: 'a'.repeat(TRACE_LIMITS.itemChars - 5) + ' ' + secret,
  });
  assert.ok(!straddle.text!.includes('sk-proj'));
  assert.ok(!straddle.text!.includes('abcdefgh'));

  const emoji = summarizeItem({
    role: 'user',
    content: 'a'.repeat(TRACE_LIMITS.itemChars - 1) + '😀',
  });
  assert.ok(!/[\uD800-\uDBFF]$/.test(emoji.text!), 'never ends on half a character');
});

test('tools are listed by name, description and argument names only', () => {
  const tools = summarizeTools([
    {
      type: 'function',
      name: 'edit_file',
      description: 'd'.repeat(1_000),
      parameters: { type: 'object', properties: { path: {}, content: {} } },
    },
    { type: 'hosted_tool', name: 'web_search' },
    { type: 'shell' },
    'garbage',
  ]);
  assert.deepEqual(tools[0].parameters, ['path', 'content']);
  assert.equal(tools[0].description!.length, TRACE_LIMITS.descriptionChars);
  assert.deepEqual(tools[1], { name: 'web_search', type: 'hosted' });
  assert.deepEqual(tools[2], { name: 'shell', type: 'other' });
  assert.deepEqual(tools[3], { name: 'unknown', type: 'other' });
});

test('a call records what trimming did, and keeps only the newest items of a very long request', () => {
  const messages = Array.from({ length: TRACE_LIMITS.itemsPerCall + 10 }, (_, i) => ({
    role: 'user',
    content: `message ${i}`,
  }));
  const request = {
    systemInstructions: 'Be helpful.',
    input: messages,
    modelSettings: { maxTokens: 512, toolChoice: 'auto', reasoning: { effort: 'low' } },
    tools: [],
  } as unknown as ModelRequest;
  const response = {
    output: [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] },
    ],
    usage: new Usage({ inputTokens: 7, outputTokens: 2, totalTokens: 9 }),
  } as unknown as ModelResponse;
  const call = summarizeCall({
    agent: 'orbit',
    startedAt: 5,
    durationMs: 12,
    request,
    charsBefore: 9_000,
    charsSent: 4_000,
    budget: 5_000,
    removedItems: 3,
    trimmedToolOutputs: 1,
    response,
  });
  assert.equal(call.input.length, TRACE_LIMITS.itemsPerCall);
  assert.equal(call.omittedItems, 10);
  assert.equal(call.input.at(-1)!.text, `message ${TRACE_LIMITS.itemsPerCall + 9}`);
  assert.deepEqual(call.context, {
    chars: 4_000,
    charsBefore: 9_000,
    budget: 5_000,
    removedItems: 3,
    trimmedToolOutputs: 1,
  });
  assert.deepEqual(call.settings, {
    reasoningEffort: 'low',
    maxOutputTokens: 512,
    toolChoice: 'auto',
  });
  assert.deepEqual(call.usage, { inputTokens: 7, outputTokens: 2, totalTokens: 9 });
  assert.equal(call.output[0].text, 'ok');
});

const entry = (agent: string, ...texts: string[]): Omit<TraceCall, 'index'> => ({
  agent,
  at: 0,
  durationMs: 1,
  instructions: '',
  instructionsChars: 0,
  tools: [],
  settings: {},
  context: { chars: 1, charsBefore: 1, budget: 10, removedItems: 0, trimmedToolOutputs: 0 },
  input: texts.map((text): TraceItem => ({ kind: 'user', text, chars: text.length })),
  omittedItems: 0,
  output: [],
  usage: null,
});

test('the store marks what each agent had not already sent, per agent', () => {
  const store = new TraceStore();
  store.record('run', entry('orbit', 'first'));
  store.record('run', entry('orbit', 'first', 'second'));
  store.record('run', entry('nova', 'first'));
  const [one, two, three] = store.get('run')!.calls;
  assert.deepEqual([one.index, two.index, three.index], [1, 2, 3]);
  assert.equal(one.input[0].fresh, undefined, 'a first call has nothing to compare with');
  assert.deepEqual(
    two.input.map((i) => i.fresh),
    [false, true],
  );
  assert.equal(three.input[0].fresh, undefined, 'another agent starts its own comparison');
});

test('the store is bounded by calls per run, characters per run, runs, and total characters', () => {
  const calls = new TraceStore();
  for (let i = 0; i < TRACE_LIMITS.callsPerRun + 5; i++)
    calls.record('run', entry('orbit', `m${i}`));
  assert.equal(calls.get('run')!.calls.length, TRACE_LIMITS.callsPerRun);
  assert.equal(calls.get('run')!.truncated, true);

  const big = (i: number) =>
    entry('orbit', ...Array.from({ length: 60 }, (_, n) => `${i}-${n}-` + 'x'.repeat(1_400)));
  const chars = new TraceStore();
  for (let i = 0; i < TRACE_LIMITS.callsPerRun; i++) chars.record('run', big(i));
  const kept = chars.get('run')!;
  assert.ok(kept.calls.length < TRACE_LIMITS.callsPerRun);
  assert.ok(JSON.stringify(kept.calls).length <= TRACE_LIMITS.charsPerRun);
  assert.equal(kept.truncated, true);

  const runs = new TraceStore();
  for (let i = 0; i <= TRACE_LIMITS.runs; i++) runs.record(`run-${i}`, entry('orbit', 'hi'));
  assert.equal(runs.get('run-0'), undefined, 'the oldest run is dropped first');
  assert.ok(runs.get(`run-${TRACE_LIMITS.runs}`));

  const total = new TraceStore();
  for (let r = 0; r < 12; r++) for (let i = 0; i < 12; i++) total.record(`big-${r}`, big(i));
  let stored = 0;
  for (let r = 0; r < 12; r++) stored += JSON.stringify(total.get(`big-${r}`)?.calls ?? []).length;
  assert.ok(stored <= TRACE_LIMITS.charsInStore + TRACE_LIMITS.charsPerRun);
  assert.ok(total.get('big-11'), 'the run being recorded is never the one dropped');

  total.forget('big-11');
  assert.equal(total.get('big-11'), undefined);
});

test('a real run records each call: what was sent, which part is new, and what came back', async () => {
  const trace = new TraceStore();
  const model = new ScriptedModel([
    [functionCall('remember_memory', { text: 'Prefer short answers.' }, { callId: 'remember' })],
    [assistantMessage('Saved.')],
  ]);
  const done = await adapterFor(model, trace).start({
    runId: 'loop',
    prompt: 'Remember that I like short answers.',
    team: [orbit],
  });
  assert.equal(done.status, 'completed');
  const { calls } = trace.get('loop')!;
  assert.equal(calls.length, 2);
  const [first, second] = calls;
  assert.equal(first.agent, 'coordinator');
  assert.match(first.instructions, /Keep the plan and talk to the user/);
  assert.ok(first.instructionsChars >= first.instructions.length);
  assert.deepEqual(
    first.tools.map((t) => t.name),
    ['recall_memory', 'remember_memory', 'forget_memory'].concat(
      first.tools.slice(3).map((t) => t.name),
    ),
  );
  assert.deepEqual(first.tools.find((t) => t.name === 'remember_memory')!.parameters, ['text']);
  assert.ok(first.input.some((i) => i.kind === 'user' && /short answers/.test(i.text ?? '')));
  assert.deepEqual(
    first.output.map((i) => [i.kind, i.name]),
    [['tool_call', 'remember_memory']],
  );
  assert.deepEqual(first.usage && Object.keys(first.usage), [
    'inputTokens',
    'outputTokens',
    'totalTokens',
  ]);

  // The second call re-sends the first call's whole request and adds only the tool exchange.
  const kinds = second.input.map((i) => `${i.kind}:${i.fresh ? 'new' : 'resent'}`);
  assert.ok(kinds.includes('user:resent'), kinds.join());
  assert.ok(kinds.includes('tool_call:new'), kinds.join());
  assert.ok(kinds.includes('tool_result:new'), kinds.join());
  assert.equal(second.output[0].text, 'Saved.');
  model.assertComplete();
});

test('a failed model call is recorded with a fixed message and nothing from the provider', async () => {
  const secret = 'sk-proj-SYNTHETIC_TEST_CREDENTIAL_123456789';
  const trace = new TraceStore();
  const model = new ScriptedModel([modelError(new Error(`Authorization failed: ${secret}`))]);
  const done = await adapterFor(model, trace).start({
    runId: 'failed',
    prompt: 'Hello.',
    team: [orbit],
  });
  assert.equal(done.status, 'error');
  const { calls } = trace.get('failed')!;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].usage, null);
  assert.deepEqual(calls[0].output, []);
  assert.equal(calls[0].error, 'The model call failed.');
  assert.ok(!JSON.stringify(calls).includes(secret));
  assert.ok(!JSON.stringify(calls).includes('Authorization failed'));
});

test('a credential in what the model says or asks for never reaches the trace', async () => {
  const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
  // The app blocks a credential-like action or memory, but the model's reply was already received
  // by then, so the trace has to redact it as well.
  const asked = new TraceStore();
  const blocked = await adapterFor(
    new ScriptedModel([
      [functionCall('remember_memory', { text: `My token is ${secret}` }, { callId: 'remember' })],
    ]),
    asked,
  ).start({ runId: 'asked', prompt: 'Remember my token.', team: [orbit] });
  assert.equal(blocked.status, 'error');
  const askedCall = asked.get('asked')!.calls[0];
  assert.equal(askedCall.output[0].name, 'remember_memory');
  assert.match(askedCall.output[0].text!, /\[REDACTED\]/);
  assert.ok(!JSON.stringify(asked.get('asked')).includes(secret));

  const said = new TraceStore();
  await adapterFor(new ScriptedModel([[assistantMessage(`Your key is ${secret}.`)]]), said).start({
    runId: 'said',
    prompt: 'What is my key?',
    team: [orbit],
  });
  assert.ok(!JSON.stringify(said.get('said')).includes(secret));
  assert.match(said.get('said')!.calls[0].output[0].text!, /\[REDACTED\]/);
});

test('a run without a trace store behaves as before and records nothing', async () => {
  const model = new ScriptedModel([[assistantMessage('Hello.')]]);
  const done = await createSdkAdapter({
    harness: noWorkspace,
    model,
    workspaceToolsEnabled: false,
    webSearchEnabled: false,
  }).start({ runId: 'plain', prompt: 'Hi.', team: [orbit] });
  assert.equal(done.status, 'completed');
});

test('the trace endpoint serves a finished run to its own session, and only to that conversation', async () => {
  const port = 45345,
    base = `http://127.0.0.1:${port}`;
  const app = createApp({ port, mode: 'demo', demoDelayMs: 1 });
  await new Promise<void>((resolve) => app.server.listen(port, '127.0.0.1', resolve));
  try {
    const session = await fetch(base + '/api/session', { headers: { Connection: 'close' } });
    const { csrf } = (await session.json()) as { csrf: string };
    const headers = {
      Cookie: session.headers.get('set-cookie')!.split(';')[0],
      Origin: base,
      'X-Tinkerfleet-CSRF': csrf,
      'Content-Type': 'application/json',
      Connection: 'close',
    };
    const started = await fetch(base + '/api/runs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: 'Create a patient astronomy tutor called Nova.' }),
    });
    assert.equal(started.status, 201);
    const { id, conversationId } = (await started.json()) as { id: string; conversationId: string };
    for (let i = 0; i < 200 && app.state().runs.find((r) => r.id === id)?.status === 'running'; i++)
      await delay(5);
    const url = `${base}/api/conversations/${conversationId}/runs/${id}/trace`;

    const ok = await fetch(url, { headers });
    assert.equal(ok.status, 200);
    const trace = (await ok.json()) as RunTrace;
    assert.equal(trace.available, true);
    assert.ok(trace.calls.length >= 2, 'creating a bot takes a tool call and a closing reply');
    assert.ok(trace.calls[0].tools.some((t) => t.name === 'create_agent'));
    assert.equal(
      trace.calls.at(-1)!.input.some((i) => i.kind === 'tool_result'),
      true,
      'the last call saw the tool result',
    );

    assert.equal((await fetch(url, { headers: { Connection: 'close' } })).status, 401);
    assert.equal((await fetch(url.replace(conversationId, 'other-chat'), { headers })).status, 404);
    assert.equal((await fetch(url.replace(id, 'no-such-run'), { headers })).status, 404);
    assert.equal(
      (await fetch(url, { method: 'POST', headers, body: '{}' })).status,
      404,
      'the trace is read-only',
    );
  } finally {
    await app.close();
  }
});

test('a trace is not saved: after a restart the run is still listed but its trace is unavailable', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(tmpdir(), 'tinkerfleet-trace-')),
    statePath = path.join(dir, 'conversations.json');
  const port = 45346,
    base = `http://127.0.0.1:${port}`;
  const open = async () => {
    const app = createApp({ port, mode: 'demo', demoDelayMs: 1, statePath });
    await new Promise<void>((resolve) => app.server.listen(port, '127.0.0.1', resolve));
    const session = await fetch(base + '/api/session', { headers: { Connection: 'close' } });
    const { csrf } = (await session.json()) as { csrf: string };
    return {
      app,
      headers: {
        Cookie: session.headers.get('set-cookie')!.split(';')[0],
        Origin: base,
        'X-Tinkerfleet-CSRF': csrf,
        'Content-Type': 'application/json',
        Connection: 'close',
      },
    };
  };
  let { app, headers } = await open();
  try {
    const started = await fetch(base + '/api/runs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: 'Create a patient astronomy tutor called Nova.' }),
    });
    const { id, conversationId } = (await started.json()) as { id: string; conversationId: string };
    for (let i = 0; i < 200 && app.state().runs.find((r) => r.id === id)?.status === 'running'; i++)
      await delay(5);
    const url = `${base}/api/conversations/${conversationId}/runs/${id}/trace`;
    assert.equal(((await (await fetch(url, { headers })).json()) as RunTrace).available, true);
    await app.close();

    ({ app, headers } = await open());
    assert.ok(
      app.state().runs.some((r) => r.id === id),
      'the run itself was saved',
    );
    const after = (await (await fetch(url, { headers })).json()) as RunTrace;
    assert.deepEqual(after, { runId: id, available: false, calls: [], truncated: false });
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
