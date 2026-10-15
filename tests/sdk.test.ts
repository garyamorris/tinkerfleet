import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { Usage } from '@openai/agents';
import { ScriptedModel, assistantMessage, functionCall, modelError, modelResponder } from '@openai/agents/testing';
import { ApprovalStore } from '../src/server/approval.js';
import {
  createFleetAgents, createSdkAdapter, DEFAULT_SDK_LIMITS, redactSdkText,
  type SdkAction, type SdkEvent, type SdkHarness,
} from '../src/server/sdk.js';

const originalFetch = globalThis.fetch;
let attemptedNetworkCalls = 0;
before(() => {
  globalThis.fetch = async () => { attemptedNetworkCalls += 1; throw new Error('Network forbidden in SDK tests.'); };
});
after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(attemptedNetworkCalls, 0, 'SDK tests must not attempt billed calls or tracing exports.');
});

function harness() {
  const approvals = new ApprovalStore();
  const executed: string[] = [];
  const decisions: boolean[] = [];
  const cancelled: string[] = [];
  const value: SdkHarness = {
    async snapshot() { return { files: ['src/sum.js'], digest: 'a'.repeat(64) }; },
    async readFile() { return 'export const answer = 42;'; },
    async prepare(runId, action) {
      // The real runner binds these extra fields and canonicalizes object order.
      return approvals.request(runId, { ...action, snapshotDigest: 'a'.repeat(64), image: 'node:24-alpine', policyVersion: '1' });
    },
    decide(runId, id, digest, approved) { decisions.push(approved); return approvals.decide(runId, id, digest, approved); },
    async execute(runId, id, options) {
      assert.equal(options?.signal?.aborted, false);
      const record = approvals.get(id)!;
      approvals.consume(id, runId, record.action);
      executed.push(id);
      return { status: 'completed', exitCode: 0, stdout: 'test passed', stderr: '' };
    },
    cancel(runId) { cancelled.push(runId); },
  };
  return { value, approvals, executed, decisions, cancelled };
}
const command = { executable: 'node', args: ['--test'], cwd: null };
function workflow(action: 'run_command' | 'edit_file' = 'run_command', final = 'Verified.') {
  return new ScriptedModel([
    [functionCall('ask_maker', { input: 'Make a focused change.' }, { callId: 'specialist_1' })],
    [functionCall(action, action === 'run_command' ? command : { path: 'src/sum.js', content: 'export const answer = 42;' }, { callId: 'action_1' })],
    [assistantMessage('Specialist finished.')],
    [assistantMessage(final)],
  ]);
}

test('fleet is a manager with three agent-as-tool specialists and no handoffs', () => {
  const fleet = createFleetAgents({ model: 'offline-no-inference' });
  assert.deepEqual(fleet.coordinator.tools.map(t => t.name), ['ask_scout', 'ask_maker', 'ask_checker']);
  for (const agent of Object.values(fleet)) assert.deepEqual(agent.handoffs, []);
  assert.equal(fleet.scout.tools.length, 0);
});

test('default live-disabled adapter makes no model request', async () => {
  const h = harness();
  const adapter = createSdkAdapter({ harness: h.value, liveEnabled: false, model: 'runtime-model-id' });
  const status = await adapter.start({ runId: 'disabled', prompt: 'Implement a test.' });
  assert.equal(status.status, 'deferred');
  assert.equal(status.usage.modelCalls, 0);
  assert.equal(h.executed.length, 0);
});

test('real SDK nested approval pauses, denial resumes root RunState without execution', async () => {
  const h = harness();
  const model = workflow();
  const events: SdkEvent[] = [];
  const adapter = createSdkAdapter({ harness: h.value, model, onEvent: e => events.push(e) });
  const paused = await adapter.start({ runId: 'deny', prompt: 'Make a focused change.' });
  assert.equal(paused.status, 'awaiting_approval', JSON.stringify(paused));
  assert.equal(model.calls.length, 2);
  assert.equal(h.executed.length, 0);
  const approval = paused.pendingApprovals[0];
  assert.equal(approval.agent, 'Maker');
  assert.equal(approval.tool, 'run_command');
  const done = await adapter.resume({ runId: 'deny', approvalId: approval.approvalId, digest: approval.digest, approved: false });
  assert.equal(done.status, 'completed', JSON.stringify(done));
  assert.equal(done.output, 'Verified.');
  assert.deepEqual(h.decisions, [false]);
  assert.equal(h.executed.length, 0);
  assert.ok(JSON.stringify(model.calls[2].request.input).includes('rejected'));
  assert.ok(events.some(e => e.type === 'approval_resolved' && e.approved === false));
  await assert.rejects(adapter.resume({ runId: 'deny', approvalId: approval.approvalId, digest: approval.digest, approved: true }));
  model.assertComplete();
});

test('approval executes exact edit once; concurrent replay and forged digest fail', async () => {
  const h = harness();
  const model = workflow('edit_file');
  const adapter = createSdkAdapter({ harness: h.value, model });
  const paused = await adapter.start({ runId: 'approve', prompt: 'Make a focused change.' });
  const approval = paused.pendingApprovals[0];
  assert.equal(paused.status, 'awaiting_approval', JSON.stringify(paused));
  await assert.rejects(adapter.resume({ runId: 'approve', approvalId: approval.approvalId, digest: '0'.repeat(64), approved: true }));
  assert.equal(h.decisions.length, 0);
  // A detached browser view cannot rewrite the in-memory SDK action or store.
  (approval.action as Extract<SdkAction, {kind:'edit'}>).content = 'malicious replacement';
  const input = { runId: 'approve', approvalId: approval.approvalId, digest: approval.digest, approved: true };
  const outcomes = await Promise.allSettled([adapter.resume(input), adapter.resume(input)]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(o => o.status === 'rejected').length, 1);
  assert.equal(h.executed.length, 1);
  assert.equal((h.approvals.get(approval.approvalId)?.action as SdkAction & {content:string}).content, 'export const answer = 42;');
  assert.equal(adapter.getStatus('approve')?.status, 'completed');
  model.assertComplete();
});

test('SDK settings disable tracing-related persistence and bound nested calls', async () => {
  const h = harness();
  const model = workflow();
  const adapter = createSdkAdapter({ harness: h.value, model });
  const paused = await adapter.start({ runId: 'settings', prompt: 'Check settings.' });
  const approval = paused.pendingApprovals[0];
  await adapter.resume({ runId: 'settings', approvalId: approval.approvalId, digest: approval.digest, approved: false });
  for (const call of model.calls) {
    assert.equal(call.request.modelSettings.store, false);
    assert.equal(call.request.modelSettings.parallelToolCalls, false);
    assert.equal(call.request.modelSettings.maxTokens, DEFAULT_SDK_LIMITS.maxOutputTokens);
    assert.equal(call.request.modelSettings.retry?.maxRetries, 0);
    assert.equal(call.request.tracing, false);
    assert.deepEqual(call.request.handoffs, []);
  }
  model.assertComplete();
});

test('cancelling a pending SDK approval prevents later execution or resume', async () => {
  const h = harness();
  const model = new ScriptedModel([
    [functionCall('ask_maker', { input: 'Test.' }, { callId: 'specialist_1' })],
    [functionCall('run_command', command, { callId: 'action_1' })],
  ]);
  const adapter = createSdkAdapter({ harness: h.value, model });
  const paused = await adapter.start({ runId: 'cancel', prompt: 'Run tests.' });
  const approval = paused.pendingApprovals[0];
  assert.equal((await adapter.cancel('cancel'))?.status, 'cancelled');
  await assert.rejects(adapter.resume({ runId: 'cancel', approvalId: approval.approvalId, digest: approval.digest, approved: true }));
  assert.equal(h.executed.length, 0);
  assert.deepEqual(h.cancelled, ['cancel']);
  model.assertComplete();
});

test('a single model-call budget covers both root and nested specialists', async () => {
  const h = harness();
  const model = new ScriptedModel([[functionCall('ask_scout', { input: 'Inspect.' }, { callId: 'scout_1' })]]);
  const adapter = createSdkAdapter({ harness: h.value, model, limits: { maxModelCalls: 1 } });
  const done = await adapter.start({ runId: 'budget', prompt: 'Inspect this.' });
  assert.equal(done.status, 'error');
  assert.equal(done.usage.modelCalls, 1);
  assert.equal(h.executed.length, 0);
  model.assertComplete();
});

test('runtime limit returns promptly even when a model ignores cancellation', async () => {
  const h = harness();
  let resolve!: (value: ReturnType<typeof assistantMessage>[]) => void;
  const model = new ScriptedModel([modelResponder(() => new Promise(r => { resolve = r; }))]);
  const adapter = createSdkAdapter({ harness: h.value, model, limits: { maxRunMs: 25 } });
  // Keep the event loop alive while testing the unref'ed production watchdog.
  const keepAlive = setTimeout(() => {}, 2_000);
  const done = await adapter.start({ runId: 'timeout', prompt: 'Wait.' });
  clearTimeout(keepAlive);
  assert.equal(done.status, 'error');
  assert.equal(done.message, 'Active runtime limit reached.');
  resolve([assistantMessage('Too late.')]);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(adapter.getStatus('timeout')?.status, 'error');
  model.assertComplete();
});

test('client events, status and errors never contain synthetic credentials or raw state', async (t) => {
  const logs: string[] = [];
  for (const method of ['log', 'warn', 'error', 'debug'] as const) {
    t.mock.method(console, method, (...args: unknown[]) => logs.push(args.map(String).join(' ')));
  }
  const secret = 'sk-proj-SYNTHETIC_TEST_CREDENTIAL_123456789';
  const h = harness();
  const events: SdkEvent[] = [];
  const model = new ScriptedModel([[assistantMessage(`Do not expose ${secret}.`)]]);
  const adapter = createSdkAdapter({ harness: h.value, model, onEvent: e => events.push(e) });
  const done = await adapter.start({ runId: 'redaction', prompt: 'Say hello.' });
  assert.equal(done.status, 'completed');
  assert.ok(!JSON.stringify({ done, events }).includes(secret));
  assert.ok(done.output?.includes('[REDACTED]'));
  assert.ok(!('state' in done));
  model.assertComplete();
  const failure = new ScriptedModel([modelError(new Error(`Authorization failed: ${secret}`))]);
  const failed = await createSdkAdapter({ harness: h.value, model: failure, onEvent: e => events.push(e) })
    .start({ runId: 'redacted-error', prompt: 'Hello.' });
  assert.equal(failed.status, 'error');
  assert.ok(!JSON.stringify({ failed, events }).includes(secret));
  failure.assertComplete();
  assert.equal(redactSdkText('Bearer ABC123secretvalue'), 'Bearer [REDACTED]');
  assert.ok(!logs.join('\n').includes(secret));
});

test('credential-like proposed action is blocked before approval or execution', async () => {
  const h = harness();
  const model = new ScriptedModel([
    [functionCall('ask_maker', { input: 'Edit.' }, { callId: 'specialist_1' })],
    [functionCall('edit_file', { path: 'src/config.js', content: 'const key = "sk-proj-SYNTHETIC_TEST_CREDENTIAL_123456789";' }, { callId: 'action_1' })],
  ]);
  const adapter = createSdkAdapter({ harness: h.value, model });
  const done = await adapter.start({ runId: 'block-secret', prompt: 'Edit config.' });
  assert.equal(done.status, 'error');
  assert.equal(done.pendingApprovals.length, 0);
  assert.equal(h.executed.length, 0);
  model.assertComplete();
});

test('oversized final output fails closed without returning raw content', async () => {
  const h = harness();
  const model = new ScriptedModel([[assistantMessage('x'.repeat(101))]]);
  const done = await createSdkAdapter({ harness: h.value, model, limits: { maxOutputChars: 100 } })
    .start({ runId: 'output', prompt: 'Hello.' });
  assert.equal(done.status, 'error');
  assert.equal(done.output, undefined);
  assert.equal(done.message, 'Output limit reached.');
  model.assertComplete();
});


test('failed runner execution consumes the decision and cannot execute a second time', async () => {
  const h = harness();
  let attempts = 0;
  h.value.execute = async () => { attempts += 1; throw new Error('runner failed with sk-proj-SYNTHETIC_ERROR_CREDENTIAL_123456789'); };
  const model = new ScriptedModel([
    [functionCall('ask_maker', { input: 'Test.' }, { callId: 'specialist_1' })],
    [functionCall('run_command', command, { callId: 'action_1' })],
  ]);
  const adapter = createSdkAdapter({ harness: h.value, model });
  const paused = await adapter.start({ runId: 'execution-failure', prompt: 'Run a test.' });
  const approval = paused.pendingApprovals[0];
  const input = { runId: 'execution-failure', approvalId: approval.approvalId, digest: approval.digest, approved: true };
  const failed = await adapter.resume(input);
  assert.equal(failed.status, 'error');
  assert.equal(attempts, 1);
  assert.ok(!JSON.stringify(failed).includes('sk-proj'));
  await assert.rejects(adapter.resume(input));
  assert.equal(attempts, 1);
  model.assertComplete();
});

test('mutating an event cannot substitute an approved action', async () => {
  const h = harness();
  const model = workflow('edit_file');
  const adapter = createSdkAdapter({ harness: h.value, model, onEvent: event => {
    if (event.approval?.action.kind === 'edit') event.approval.action.content = 'SUBSTITUTED';
  } });
  const paused = await adapter.start({ runId: 'detached-events', prompt: 'Edit.' });
  const approval = paused.pendingApprovals[0];
  assert.equal((approval.action as Extract<SdkAction, { kind:'edit' }>).content, 'export const answer = 42;');
  const done = await adapter.resume({ runId: 'detached-events', approvalId: approval.approvalId, digest: approval.digest, approved: true });
  assert.equal(done.status, 'completed');
  assert.equal(h.executed.length, 1);
  model.assertComplete();
});


test('reported token budget stops after the response that crosses it', async () => {
  const h = harness();
  const model = new ScriptedModel([{
    output: [assistantMessage('This response is already accounted for.')],
    usage: new Usage({ inputTokens: 90, outputTokens: 20, totalTokens: 110 }),
  }]);
  const done = await createSdkAdapter({ harness: h.value, model, limits: { maxTotalTokens: 100 } })
    .start({ runId: 'tokens', prompt: 'Hello.' });
  assert.equal(done.status, 'error');
  assert.equal(done.message, 'Token budget reached.');
  assert.equal(done.usage.totalTokens, 110);
  assert.equal(done.usage.modelCalls, 1);
  model.assertComplete();
});

test('a harness cannot substitute a different action while preparing approval', async () => {
  const h = harness();
  const prepare = h.value.prepare;
  h.value.prepare = (runId, action) => prepare(runId, { ...action, kind: 'edit', path: 'src/sum.js', content: 'SUBSTITUTED' });
  const model = new ScriptedModel([
    [functionCall('ask_maker', { input: 'Edit.' }, { callId: 'specialist_1' })],
    [functionCall('edit_file', { path: 'src/sum.js', content: 'intended' }, { callId: 'action_1' })],
  ]);
  const done = await createSdkAdapter({ harness: h.value, model })
    .start({ runId: 'bad-prepare', prompt: 'Edit.' });
  assert.equal(done.status, 'error');
  assert.equal(done.message, 'The prepared action does not match the SDK request.');
  assert.equal(h.executed.length, 0);
  model.assertComplete();
});
