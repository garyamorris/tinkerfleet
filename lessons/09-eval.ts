/**
 * Lesson 9: measure whether an agent actually works.
 *
 * An eval gives the agent a task, lets it work, then grades the outcome with code the
 * agent cannot influence. Each attempt here gets a fresh copy of tiny-project; the agent
 * works through the app's real adapter, approvals and runner; then a grader runs the
 * tests itself and checks the agent did not edit them.
 *
 *   npm run lesson:9           the scripted demo model plays the agent (checks the harness)
 *   npm run eval -- --live     your configured model (uses .env.local; costs money)
 *   add --runs 3               models vary from run to run, so try each case several times
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { ApprovalStore } from '../src/server/approval.js';
import { DemoModel, createDemoWorkspace } from '../src/server/demo.js';
import { NativeWorkspaceRunner } from '../src/server/native-runner.js';
import { createSdkAdapter, type SdkAction, type SdkHarness } from '../src/server/sdk.js';
import type { Persona } from '../src/shared/types.js';

const live = process.argv.includes('--live');
const runsArg = process.argv.indexOf('--runs');
const runs = runsArg > 0 ? Math.max(1, Number(process.argv[runsArg + 1]) || 1) : 1;
if (live && (process.env.TINKERFLEET_MODE !== 'live' || !process.env.TINKERFLEET_MODEL)) {
  console.error('A live eval needs TINKERFLEET_MODE=live, TINKERFLEET_MODEL and OPENAI_API_KEY.');
  process.exit(1);
}

const cases = [
  'Fix the failing tests in tiny-project.',
  'The sum function in tiny-project is broken. Make its tests pass.',
];
const agent: Persona = {
  id: 'eval-agent',
  name: 'Fixer',
  purpose: 'Fix small bugs carefully and verify the result.',
  role: 'agent',
  color: '#3a7d82',
  shape: 'orbit',
};

/**
 * The eval approves on the user's behalf, so it needs its own narrow policy. Edits stay
 * inside the temporary copy; the only commands allowed are the project's tests.
 */
function policy(action: SdkAction): boolean {
  if (action.kind === 'edit') return true;
  const args = action.args.join(' ');
  return (
    (action.executable === 'node' && /^--test\b/.test(args)) ||
    (action.executable === 'npm' && args === 'test')
  );
}

const sha = async (file: string) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');

async function attempt(prompt: string, index: number) {
  const root = createDemoWorkspace();
  const testFile = path.join(root, 'sum.test.js');
  const testsBefore = await sha(testFile);
  const approvals = new ApprovalStore();
  const runner = new NativeWorkspaceRunner({ workspaceRoot: root, approvals });
  const harness: SdkHarness = {
    snapshot: (id) => runner.snapshot(id),
    readFile: (id, name) => runner.readFile(id, name),
    prepare: (id, action) => runner.prepare(id, action),
    decide: (id, approvalId, digest, approved) =>
      approvals.decide(id, approvalId, digest, approved),
    execute: (id, approvalId, options) => runner.execute(id, approvalId, options),
    cancel: (id) => runner.cancel(id),
  };
  const adapter = createSdkAdapter({
    harness,
    model: live ? process.env.TINKERFLEET_MODEL : new DemoModel(0),
    liveEnabled: live,
    webSearchEnabled: false,
    workspaceRoot: root,
  });
  const started = Date.now();
  const declined: string[] = [];
  try {
    let status = await adapter.start({ runId: `eval-${index}`, prompt, team: [agent] });
    while (status.status === 'awaiting_approval') {
      const pending = status.pendingApprovals[0];
      const approved = policy(pending.action);
      if (!approved && pending.action.kind === 'command')
        declined.push(`${pending.action.executable} ${pending.action.args.join(' ')}`);
      status = await adapter.resume({
        runId: status.runId,
        approvalId: pending.approvalId,
        digest: pending.digest,
        approved,
      });
    }
    // The grader: run the tests ourselves, and make sure the agent did not change them.
    const tests = await promisify(execFile)(process.execPath, ['--test'], { cwd: root }).then(
      () => 'pass',
      () => 'fail',
    );
    const tampered = (await sha(testFile)) !== testsBefore;
    return {
      passed: tests === 'pass' && !tampered,
      reason: tampered ? 'edited the tests' : `tests ${tests}`,
      run: status.status,
      modelCalls: status.usage.modelCalls,
      tokens: status.usage.totalTokens,
      declined,
      seconds: (Date.now() - started) / 1000,
    };
  } finally {
    await runner.shutdown();
    await rm(root, { recursive: true, force: true });
  }
}

console.log(`  ${live ? `live model ${process.env.TINKERFLEET_MODEL}` : 'scripted demo model'}`);
const results = [];
for (const [c, prompt] of cases.entries())
  for (let r = 0; r < runs; r++) {
    const result = await attempt(prompt, c * runs + r);
    results.push(result);
    console.log(
      `  ${result.passed ? 'PASS' : 'FAIL'}  case ${c + 1} run ${r + 1}: ${result.reason}, ` +
        `${result.modelCalls} model calls, ${result.tokens} tokens, ${result.seconds.toFixed(1)}s` +
        (result.declined.length ? `, declined: ${result.declined.join('; ')}` : ''),
    );
  }
const passed = results.filter((r) => r.passed).length;
console.log(`  score: ${passed}/${results.length}`);

if (!live) assert.equal(passed, results.length, 'the scripted model should pass every case');
console.log('9. Evals: grade the outcome yourself, with a narrow approval policy, over many runs.');
console.log('Exercise: add a case the scripted model cannot handle. What does a failure report?');
