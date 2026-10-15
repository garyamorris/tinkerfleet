import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, realpath, mkdir, writeFile, readFile, rm, symlink, link, rename, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ApprovalStore} from '../src/server/approval.js';
import {NativeWorkspaceRunner, createNativeProcessExecutor} from '../src/server/native-runner.js';
import {RUNNER_LIMITS, validateAction, validateRelativePath, type ProcessExecutor} from '../src/server/runner-policy.js';

async function fixture(t: test.TestContext, executeProcess?: ProcessExecutor) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'tinkerfleet-native-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/math.js'), 'export const add = (a,b) => a-b;\n');
  await writeFile(path.join(root, 'smoke.js'), 'console.log("hello from local node");\n');
  const approvals = new ApprovalStore();
  const runner = new NativeWorkspaceRunner({workspaceRoot: root, approvals, executeProcess});
  t.after(() => runner.shutdown());
  return {root, approvals, runner};
}

test('native runner requires exact approval, writes the real selected file, and consumes once', async t => {
  const {root, approvals, runner} = await fixture(t);
  assert.deepEqual(await runner.checkAvailability(), {available: true});
  const input = {kind: 'edit', path: 'src/math.js', content: 'export const add = (a,b) => a+b;\n'};
  const record = await runner.prepare('first', input);
  assert.equal(record.action.workspaceRoot, root);
  assert.equal(record.action.policyVersion, 'native-1');
  input.content = 'caller changed this';
  assert.ok(Object.isFrozen(record.action));
  await assert.rejects(runner.execute('first', record.id), {code: 'NOT_APPROVED'});
  await assert.rejects(runner.execute('other', record.id), {code: 'UNKNOWN_ACTION'});
  assert.match(await readFile(path.join(root, input.path), 'utf8'), /a-b/);
  approvals.approve(record.id);
  const result = await runner.execute('first', record.id);
  assert.equal(result.status, 'completed'); assert.equal(result.cleanupSucceeded, true);
  assert.notEqual(result.snapshotDigest, record.action.snapshotDigest);
  assert.match(await readFile(path.join(root, input.path), 'utf8'), /a\+b/);
  assert.match(await runner.readFile('other', input.path), /a\+b/);
  assert.equal(approvals.get(record.id)?.status, 'consumed');
  await assert.rejects(runner.execute('first', record.id), {code: 'UNKNOWN_ACTION'});
  assert.equal((await readdir(path.join(root, 'src'))).some(name => name.startsWith('.tinkerfleet')), false);
});

test('new file creation requires an existing safe parent', async t => {
  const {root, approvals, runner} = await fixture(t);
  const grant = await runner.prepare('first', {kind: 'edit', path: 'src/new.txt', content: 'created locally\n'});
  approvals.approve(grant.id); assert.equal((await runner.execute('first', grant.id)).status, 'completed');
  assert.equal(await readFile(path.join(root, 'src/new.txt'), 'utf8'), 'created locally\n');
  await assert.rejects(runner.prepare('first', {kind: 'edit', path: 'missing/new.txt', content: 'no'}));
});

test('any included file change or workspace replacement invalidates approval', async t => {
  const {root, runner, approvals} = await fixture(t);
  const grant = await runner.prepare('first', {kind: 'edit', path: 'src/math.js', content: 'approved'});
  approvals.approve(grant.id);
  await writeFile(path.join(root, 'smoke.js'), 'external edit');
  await assert.rejects(runner.execute('first', grant.id), {code: 'STALE_APPROVAL'});
  assert.equal(approvals.get(grant.id)?.status, 'denied');
  assert.match(await readFile(path.join(root, 'src/math.js'), 'utf8'), /a-b/);
  const next = await runner.prepare('second', {kind: 'command', executable: 'node', args: ['--version']});
  approvals.approve(next.id);
  await rename(path.join(root, 'src'), path.join(root, 'oldsrc'));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/math.js'), 'same visible content');
  await assert.rejects(runner.execute('second', next.id), {code: 'STALE_APPROVAL'});
});

test('hidden, credential, binary, linked and dependency files never enter context or edits', async t => {
  const {root, runner} = await fixture(t);
  await mkdir(path.join(root, 'node_modules'));
  await writeFile(path.join(root, 'node_modules/private.js'), 'hidden');
  await writeFile(path.join(root, '.env'), 'PRIVATE=value');
  await writeFile(path.join(root, 'credentials.txt'), 'private');
  await writeFile(path.join(root, 'binary.txt'), Buffer.from([0, 255, 254]));
  await writeFile(path.join(root, 'config.txt'), `api_key="${'x'.repeat(24)}"`);
  await symlink(path.join(root, 'smoke.js'), path.join(root, 'linked.js'));
  await link(path.join(root, 'smoke.js'), path.join(root, 'hard.js'));
  await symlink(path.join(root, 'src'), path.join(root, 'linked-dir'));
  const snapshot = await runner.snapshot('first');
  assert.deepEqual(snapshot.files, ['src/math.js']);
  for (const name of ['.env', 'credentials.txt', 'binary.txt', 'config.txt', 'linked.js', 'hard.js', 'linked-dir/hello.txt', 'node_modules/private.js']) {
    await assert.rejects(runner.readFile('first', name));
    await assert.rejects(runner.prepare('first', {kind: 'edit', path: name, content: 'overwrite'}));
  }
  for (const name of ['../outside.txt', '/tmp/outside.txt', 'src/../../x.js', 'src\\x.js', 'src/.hidden', 'src//x.js']) assert.throws(() => validateRelativePath(name));
});

test('oversized source, credential edit content, and unsafe command forms are rejected', async t => {
  const {root, runner} = await fixture(t);
  for (const action of [
    {kind: 'command', executable: 'npm', args: ['test']},
    {kind: 'command', executable: 'node', args: ['-e', 'process.exit()']},
    {kind: 'command', executable: 'node', args: ['--test']},
    {kind: 'command', executable: 'node', args: ['--test', 'readme.txt']},
    {kind: 'command', executable: 'cat', args: ['../outside']},
    {kind: 'command', executable: 'ls', args: ['-a']},
    {kind: 'edit', path: 'key.txt', content: `sk-${'x'.repeat(40)}`},
    {kind: 'edit', path: 'invalid.txt', content: '\ud800'},
    {kind: 'edit', path: 'large.txt', content: 'x'.repeat(RUNNER_LIMITS.fileBytes + 1)},
  ]) assert.throws(() => validateAction(action));
  await assert.rejects(runner.prepare('first', {kind: 'command', executable: 'node', args: ['missing.js']}), {code: 'FILE_NOT_FOUND'});
  await writeFile(path.join(root, 'too-large.txt'), Buffer.alloc(RUNNER_LIMITS.fileBytes + 1, 65));
  await assert.rejects(runner.snapshot('first'), {code: 'SNAPSHOT_LIMIT'});
});

test('actual Node execution uses selected cwd, drops inherited environment, and redacts output', async t => {
  const {root, runner, approvals} = await fixture(t);
  const inheritedName = 'TINKERFLEET_TEST_PRIVATE_VALUE';
  process.env[inheritedName] = 'must-not-be-inherited'; t.after(() => { delete process.env[inheritedName]; });
  await writeFile(path.join(root, 'smoke.js'), `console.log(process.cwd()); console.log(process.env.${inheritedName} ?? 'absent'); console.log('sk-' + 'x'.repeat(40)); console.log('AKIA' + 'A'.repeat(16));`);
  const grant = await runner.prepare('first', {kind: 'command', executable: 'node', args: ['smoke.js']});
  approvals.approve(grant.id);
  const result = await runner.execute('first', grant.id);
  assert.equal(result.status, 'completed');
  assert.ok(result.stdout.includes(root)); assert.ok(result.stdout.includes('absent'));
  assert.ok(!result.stdout.includes('AKIA')); assert.ok(result.stdout.includes('[REDACTED]')); assert.ok(!result.stdout.includes('must-not-be-inherited'));
});

test('global execution lock, cancellation, and shutdown drain a running local command', async t => {
  let signalStarted!: () => void;
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  const calls: {executable: string; args: readonly string[]; cwd: string}[] = [];
  const executor: ProcessExecutor = (executable, args, options) => new Promise(resolve => {
    calls.push({executable, args, cwd: options.cwd}); signalStarted();
    options.signal!.addEventListener('abort', () => resolve({exitCode: null, stdout: '', stderr: '', termination: 'cancelled', cleanupSucceeded: true}), {once: true});
  });
  const {root, approvals, runner} = await fixture(t, executor);
  const other = new NativeWorkspaceRunner({workspaceRoot: root, approvals});
  t.after(() => other.shutdown());
  const grant = await runner.prepare('first', {kind: 'command', executable: 'node', args: ['--version']}); approvals.approve(grant.id);
  const second = await other.prepare('second', {kind: 'command', executable: 'node', args: ['--version']}); approvals.approve(second.id);
  const pending = runner.execute('first', grant.id); await started;
  await assert.rejects(other.execute('second', second.id), {code: 'RUN_BUSY'});
  assert.deepEqual(calls[0], {executable: process.execPath, args: ['--version'], cwd: root});
  assert.equal((await runner.shutdown()).cleanupSucceeded, true);
  assert.equal((await pending).status, 'cancelled');
  await assert.rejects(runner.prepare('next', {kind: 'command', executable: 'node', args: ['--version']}), {code: 'RUN_CLOSED'});
});

test('native transport caps combined output and kills process groups on timeout and cancellation', async t => {
  const {root} = await fixture(t);
  const execute = createNativeProcessExecutor();
  await writeFile(path.join(root, 'flood.js'), 'process.stdout.write("x".repeat(10000)); setInterval(()=>{},1000);');
  const flood = await execute(process.execPath, ['flood.js'], {cwd: root, timeoutMs: 1000, maxOutputBytes: 64});
  assert.equal(flood.termination, 'output_limit'); assert.ok(Buffer.byteLength(flood.stdout + flood.stderr) <= 64);
  await writeFile(path.join(root, 'hang.js'), 'setInterval(()=>{},1000);');
  const timeout = await execute(process.execPath, ['hang.js'], {cwd: root, timeoutMs: 50, maxOutputBytes: 64});
  assert.equal(timeout.termination, 'timeout');
  const controller = new AbortController();
  const pending = execute(process.execPath, ['hang.js'], {cwd: root, signal: controller.signal, timeoutMs: 1000, maxOutputBytes: 64});
  controller.abort(); assert.equal((await pending).termination, 'cancelled');
  const absent = await execute(path.join(root, 'missing-command'), [], {cwd: root, timeoutMs: 100, maxOutputBytes: 64});
  assert.match(absent.error ?? '', /Could not start/);
});

test('expired grants, cancelled preparation, and unconfirmed cleanup block execution', async t => {
  const {root} = await fixture(t);
  let now = 1;
  const approvals = new ApprovalStore({now: () => now, defaultTtlMs: 10});
  const runner = new NativeWorkspaceRunner({workspaceRoot: root, approvals, executeProcess: async () => ({exitCode: 0, stdout: '', stderr: '', cleanupSucceeded: false})});
  t.after(() => runner.shutdown());
  const stale = await runner.prepare('first', {kind: 'command', executable: 'node', args: ['--version']}); approvals.approve(stale.id); now = 12;
  await assert.rejects(runner.execute('first', stale.id), {code: 'NOT_APPROVED'});
  const preparing = runner.prepare('cancelled', {kind: 'command', executable: 'node', args: ['--version']}); runner.cancel('cancelled');
  await assert.rejects(preparing, {code: 'RUN_CLOSED'});
  const grant = await runner.prepare('second', {kind: 'command', executable: 'node', args: ['--version']}); approvals.approve(grant.id);
  assert.equal((await runner.execute('second', grant.id)).status, 'failed');
  assert.equal((await runner.checkAvailability()).available, false);
  const next = await runner.prepare('second', {kind: 'command', executable: 'node', args: ['--version']}); approvals.approve(next.id);
  await assert.rejects(runner.execute('second', next.id), {code: 'EXECUTION_BLOCKED'});
});

// An ordinary child remains in the process group even when its parent exits.
test('transport stops ordinary child processes after the parent exits', async t => {
  const {root} = await fixture(t);
  const childCode = `setTimeout(() => require('node:fs').writeFileSync('child-survived.txt', 'bad'), 150);`;
  await writeFile(path.join(root, 'parent.cjs'), `const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], {stdio: 'ignore'}); child.unref(); process.exit(0);`);
  const result = await createNativeProcessExecutor()(process.execPath, ['parent.cjs'], {cwd: root, timeoutMs: 1000, maxOutputBytes: 64});
  assert.equal(result.exitCode, 0); assert.equal(result.cleanupSucceeded, true);
  await new Promise(resolve => setTimeout(resolve, 250));
  await assert.rejects(readFile(path.join(root, 'child-survived.txt')), {code: 'ENOENT'});
});
