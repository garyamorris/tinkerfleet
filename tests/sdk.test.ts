import {customTeam} from './personas.fixture.js';
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


test('custom profile focus reaches only its fixed role without changing permissions',async()=>{
 const team=customTeam();
 const fleet=createFleetAgents({model:'offline',team});
 for(const profile of team){
  const agent=fleet[profile.role];assert.equal(agent.name,profile.role[0].toUpperCase()+profile.role.slice(1));
  assert.match(String(agent.instructions),new RegExp(profile.purpose.replace('.','\\.')));
  assert.match(String(agent.instructions),/Never request secrets/);
  for(const other of team.filter(p=>p.role!==profile.role))assert.ok(!String(agent.instructions).includes(other.purpose));
 }
 const h=harness();const model=new ScriptedModel([
  [functionCall('ask_scout',{input:'Inspect.'},{callId:'custom-scout'})],[assistantMessage('Scouted.')],
  [functionCall('ask_maker',{input:'Implement.'},{callId:'custom-maker'})],[functionCall('run_command',command,{callId:'custom-command'})],
  [assistantMessage('Made.')],[functionCall('ask_checker',{input:'Check.'},{callId:'custom-checker'})],
  [assistantMessage('Checked.')],[assistantMessage('Done.')],
 ]);
 const adapter=createSdkAdapter({model,harness:h.value});
 const pending=adapter.start({runId:'custom-roles',prompt:'Fix fixture.',team});team[2].purpose='MUTATED AFTER START';
 const paused=await pending;assert.equal(paused.status,'awaiting_approval');
 const calls=model.calls;assert.match(calls[0].request.systemInstructions!,/Focus on coordinator clarity/);
 assert.match(calls[1].request.systemInstructions!,/Focus on scout clarity/);
 assert.match(calls[3].request.systemInstructions!,/Focus on maker clarity/);
 assert.doesNotMatch(calls[3].request.systemInstructions!,/MUTATED AFTER START/);
 assert.deepEqual(calls[1].request.tools.map(t=>t.name),['list_files','read_file']);
 assert.deepEqual(calls[3].request.tools.map(t=>t.name),['list_files','read_file','run_command','edit_file']);
 assert.deepEqual(calls[0].request.tools.map(t=>t.name),['ask_scout','ask_maker','ask_checker']);
 assert.equal(h.executed.length,0);
 const a=paused.pendingApprovals[0];const done=await adapter.resume({runId:'custom-roles',approvalId:a.approvalId,digest:a.digest,approved:true});
 assert.equal(done.status,'completed');assert.equal(h.executed.length,1);
 assert.match(model.calls[6].request.systemInstructions!,/Focus on checker clarity/);model.assertComplete();
});

test('invalid SDK profiles fail before a model request',async()=>{
 const h=harness(),model=new ScriptedModel([]),adapter=createSdkAdapter({model,harness:h.value});
 await assert.rejects(adapter.start({runId:'bad-profile',prompt:'Fix fixture.',team:[customTeam()[0],customTeam()[0]]}));
 assert.equal(model.calls.length,0);assert.equal(h.executed.length,0);
});


function participants(...roles: string[]) { return customTeam().filter(profile => roles.includes(profile.role)); }

test('direct Scout has only read tools, its own profile, and correctly attributed output', async () => {
  const h = harness(), events: SdkEvent[] = [];
  const model = new ScriptedModel([[assistantMessage('Scout reply.')]]);
  const adapter = createSdkAdapter({ harness: h.value, model, onEvent: event => events.push(event) });
  const done = await adapter.start({ runId: 'direct-scout', prompt: 'Inspect.', team: participants('scout') });
  assert.equal(done.status, 'completed');
  assert.deepEqual(model.calls[0].request.tools.map(tool => tool.name), ['list_files', 'read_file']);
  assert.match(model.calls[0].request.systemInstructions!, /Focus on scout clarity/);
  assert.deepEqual(events.filter(event => event.type === 'agent_message').map(event => [event.agent, event.message]), [['Scout', 'Scout reply.']]);
  assert.equal(events.find(event => event.type === 'run_completed')?.agent, 'Scout');
  assert.ok(events.every(event => !event.agent || event.agent === 'Scout'));
  assert.equal(h.executed.length, 0);
  model.assertComplete();
});

test('direct Maker pauses for its own exact edit and resumes without a coordinator', async () => {
  const h = harness(), events: SdkEvent[] = [];
  const model = new ScriptedModel([
    [functionCall('edit_file', { path: 'src/sum.js', content: 'fixed' }, { callId: 'direct-edit' })],
    [assistantMessage('Maker applied the approved edit.')],
  ]);
  const adapter = createSdkAdapter({ harness: h.value, model, onEvent: event => events.push(event) });
  const paused = await adapter.start({ runId: 'direct-maker', prompt: 'Fix.', team: participants('maker') });
  assert.equal(paused.status, 'awaiting_approval');
  assert.equal(h.executed.length, 0);
  const approval = paused.pendingApprovals[0];
  assert.equal(approval.agent, 'Maker');
  const done = await adapter.resume({ runId: paused.runId, approvalId: approval.approvalId, digest: approval.digest, approved: true });
  assert.equal(done.status, 'completed');
  assert.equal(h.executed.length, 1);
  assert.ok(model.calls.every(call => call.request.tools.every(tool => !tool.name.startsWith('ask_'))));
  assert.deepEqual(events.filter(event => event.type === 'agent_message').map(event => event.agent), ['Maker']);
  assert.equal(events.find(event => event.type === 'approval_resolved')?.agent, 'Maker');
  model.assertComplete();
});

test('coordinator-only has no delegation; selected coordinator group exposes only included specialists', async () => {
  const h = harness(), events: SdkEvent[] = [];
  const solo = new ScriptedModel([[assistantMessage('Coordinator advice.')]]);
  await createSdkAdapter({ harness: h.value, model: solo }).start({ runId: 'solo-coordinator', prompt: 'Advise.', team: participants('coordinator') });
  assert.deepEqual(solo.calls[0].request.tools, []);
  solo.assertComplete();
  const model = new ScriptedModel([
    [functionCall('ask_scout', { input: 'Inspect.' }, { callId: 'selected-scout' })],
    [assistantMessage('Scout findings.')], [assistantMessage('Coordinator summary.')],
  ]);
  const done = await createSdkAdapter({ harness: h.value, model, onEvent: event => events.push(event) }).start({
    runId: 'selected-group', prompt: 'Inspect.', team: participants('coordinator', 'scout'),
    history: [{ id: 'previous', author: 'user', text: 'Same-chat background.', at: 1 }],
  });
  assert.equal(done.status, 'completed');
  assert.deepEqual(model.calls[0].request.tools.map(tool => tool.name), ['ask_scout']);
  assert.match(JSON.stringify(model.calls[1].request.input), /Same-chat background/);
  assert.deepEqual(events.filter(event => event.type === 'agent_message').map(event => [event.agent, event.message]), [['Scout', 'Scout findings.'], ['Coordinator', 'Coordinator summary.']]);
  assert.ok(events.every(event => !event.agent || ['Scout', 'Coordinator'].includes(event.agent)));
  model.assertComplete();
});

test('group without coordinator uses actual roots, passes within-run replies and resumes the paused root', async () => {
  const h = harness(), events: SdkEvent[] = [];
  const model = new ScriptedModel([
    [assistantMessage('Scout found the issue.')],
    [functionCall('edit_file', { path: 'src/sum.js', content: 'fixed' }, { callId: 'group-edit' })],
    [assistantMessage('Maker completed the fix.')],
    [assistantMessage('Checker reviewed the fix.')],
  ]);
  const adapter = createSdkAdapter({ harness: h.value, model, onEvent: event => events.push(event) });
  const paused = await adapter.start({ runId: 'peer-group', prompt: 'Fix it.', team: participants('scout', 'maker', 'checker') });
  assert.equal(paused.status, 'awaiting_approval');
  assert.equal(paused.pendingApprovals[0].agent, 'Maker');
  assert.deepEqual(model.calls[0].request.tools.map(tool => tool.name), ['list_files', 'read_file']);
  assert.match(JSON.stringify(model.calls[1].request.input), /Scout found the issue/);
  const approval = paused.pendingApprovals[0];
  const done = await adapter.resume({ runId: paused.runId, approvalId: approval.approvalId, digest: approval.digest, approved: true });
  assert.equal(done.status, 'completed');
  assert.equal(h.executed.length, 1);
  assert.match(model.calls[2].request.systemInstructions!, /Focus on maker clarity/);
  assert.match(model.calls[3].request.systemInstructions!, /Focus on checker clarity/);
  assert.match(JSON.stringify(model.calls[3].request.input), /Maker completed the fix/);
  assert.ok(model.calls.every(call => call.request.tools.every(tool => !tool.name.startsWith('ask_'))));
  assert.deepEqual(events.filter(event => event.type === 'agent_message').map(event => event.agent), ['Scout', 'Maker', 'Checker']);
  assert.equal(events.find(event => event.type === 'run_completed')?.agent, 'Checker');
  model.assertComplete();
});

test('group roots share one model-call budget', async () => {
  const model = new ScriptedModel([[assistantMessage('Scout findings.')]]);
  const done = await createSdkAdapter({ harness: harness().value, model, limits: { maxModelCalls: 1 } }).start({
    runId: 'peer-budget', prompt: 'Inspect and fix.', team: participants('scout', 'maker'),
  });
  assert.equal(done.status, 'error');
  assert.equal(done.message, 'Model-call limit reached.');
  assert.equal(done.usage.modelCalls, 1);
  model.assertComplete();
});

test('server-provided history reaches a follow-up and never carries into another chat', async () => {
  const model = new ScriptedModel([[assistantMessage('First reply.')], [assistantMessage('Follow-up reply.')], [assistantMessage('Independent reply.')]]);
  const adapter = createSdkAdapter({ harness: harness().value, model });
  await adapter.start({ runId: 'chat-a-first', prompt: 'CHAT_A_PRIVATE_CONTEXT', team: participants('scout') });
  const history = [
    { id: 'user-1', author: 'user' as const, text: 'CHAT_A_PRIVATE_CONTEXT', at: 1 },
    { id: 'bot-1', author: 'scout' as const, text: 'First reply.', at: 2 },
  ];
  const followUp = adapter.start({ runId: 'chat-a-followup', prompt: 'Continue.', team: participants('scout'), history });
  history[0].text = 'MUTATED_HISTORY';
  await followUp;
  await adapter.start({ runId: 'chat-b-first', prompt: 'Independent.', team: participants('scout') });
  assert.match(JSON.stringify(model.calls[1].request.input), /CHAT_A_PRIVATE_CONTEXT/);
  assert.doesNotMatch(JSON.stringify(model.calls[1].request.input), /MUTATED_HISTORY/);
  assert.doesNotMatch(JSON.stringify(model.calls[2].request.input), /CHAT_A_PRIVATE_CONTEXT|First reply|Follow-up reply/);
  model.assertComplete();
});

test('concurrent direct chats isolate approvals even with identical model call IDs', async () => {
  const h = harness();
  const model = new ScriptedModel([
    [functionCall('run_command', command, { callId: 'same-call-id' })],
    [functionCall('run_command', command, { callId: 'same-call-id' })],
    [assistantMessage('B denied.')], [assistantMessage('A approved.')],
  ]);
  const adapter = createSdkAdapter({ harness: h.value, model });
  const [a, b] = await Promise.all([
    adapter.start({ runId: 'parallel-a', prompt: 'A.', team: participants('maker') }),
    adapter.start({ runId: 'parallel-b', prompt: 'B.', team: participants('maker') }),
  ]);
  assert.equal(a.status, 'awaiting_approval'); assert.equal(b.status, 'awaiting_approval');
  const ap = a.pendingApprovals[0], bp = b.pendingApprovals[0];
  await assert.rejects(adapter.resume({ runId: a.runId, approvalId: bp.approvalId, digest: bp.digest, approved: true }));
  await assert.rejects(adapter.resume({ runId: b.runId, approvalId: ap.approvalId, digest: ap.digest, approved: true }));
  assert.equal(h.decisions.length, 0);
  assert.equal((await adapter.resume({ runId: b.runId, approvalId: bp.approvalId, digest: bp.digest, approved: false })).status, 'completed');
  assert.equal(adapter.getStatus(a.runId)?.status, 'awaiting_approval');
  assert.equal((await adapter.resume({ runId: a.runId, approvalId: ap.approvalId, digest: ap.digest, approved: true })).status, 'completed');
  assert.deepEqual(h.executed, [ap.approvalId]);
  assert.deepEqual(h.decisions, [false, true]);
  model.assertComplete();
});

test('oversized and wrong-participant history fails before any model request', async () => {
  const model = new ScriptedModel([]), adapter = createSdkAdapter({ harness: harness().value, model });
  await assert.rejects(adapter.start({ runId: 'wrong-history', prompt: 'Hello.', team: participants('scout'), history: [{ id: 'x', author: 'maker', text: 'Wrong participant.', at: 1 }] }));
  await assert.rejects(adapter.start({ runId: 'huge-history', prompt: 'Hello.', team: participants('scout'), history: [{ id: 'x', author: 'user', text: 'x'.repeat(32_001), at: 1 }] }));
  model.assertComplete();
});


test('denial lets the current peer explain but never starts the next selected peer', async () => {
  const h = harness(), events: SdkEvent[] = [];
  const model = new ScriptedModel([
    [functionCall('edit_file', { path: 'src/sum.js', content: 'proposed' }, { callId: 'declined-peer-edit' })],
    [assistantMessage('Maker stopped because the edit was declined.')],
  ]);
  const adapter = createSdkAdapter({ harness: h.value, model, onEvent: event => events.push(event) });
  const paused = await adapter.start({ runId: 'declined-peer-group', prompt: 'Fix and review.', team: participants('maker', 'checker') });
  assert.equal(paused.status, 'awaiting_approval');
  const approval = paused.pendingApprovals[0];
  const done = await adapter.resume({ runId: paused.runId, approvalId: approval.approvalId, digest: approval.digest, approved: false });
  assert.equal(done.status, 'completed');
  assert.equal(done.output, 'Maker stopped because the edit was declined.');
  assert.equal(h.executed.length, 0);
  assert.deepEqual(h.decisions, [false]);
  assert.equal(model.calls.length, 2);
  assert.match(JSON.stringify(model.calls[1].request.input), /rejected/);
  assert.ok(model.calls.every(call => /Focus on maker clarity/.test(call.request.systemInstructions!)));
  assert.ok(events.every(event => !event.agent || event.agent === 'Maker'));
  assert.deepEqual(events.filter(event => event.type === 'agent_message').map(event => event.agent), ['Maker']);
  model.assertComplete();
});

test('oversized final peer message fails closed before publishing its text or completion', async () => {
  const h = harness(), events: SdkEvent[] = [];
  const oversized = 'UNBOUNDED_MESSAGE_'.repeat(10);
  const model = new ScriptedModel([[assistantMessage('Scout findings.')], [assistantMessage(oversized)]]);
  const adapter = createSdkAdapter({ harness: h.value, model, limits: { maxOutputChars: 100 }, onEvent: event => events.push(event) });
  const done = await adapter.start({ runId: 'peer-output-limit', prompt: 'Inspect and review.', team: participants('scout', 'checker') });
  assert.equal(done.status, 'error');
  assert.equal(done.message, 'Output limit reached.');
  assert.equal(done.output, undefined);
  assert.deepEqual(events.filter(event => event.type === 'agent_message').map(event => event.agent), ['Scout']);
  assert.equal(events.filter(event => event.type === 'run_completed').length, 0);
  assert.equal(events.filter(event => event.type === 'run_failed').length, 1);
  assert.ok(!JSON.stringify({ done, events }).includes(oversized));
  model.assertComplete();
});
