import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ApprovalStore } from '../src/server/approval.js';
import { SafeContainerRunner, RUNNER_LIMITS, localDockerConnection, validateAction, validateRelativePath, type ProcessExecutor, type ProcessOptions, type ProcessResult } from '../src/server/runner.js';

const imageId = 'sha256:' + 'a'.repeat(64);
type Call = { executable: string; args: readonly string[]; options: ProcessOptions };
function fakeDocker(handler?: (call: Call) => ProcessResult | Promise<ProcessResult> | undefined) {
  const calls: Call[] = [];
  const execute: ProcessExecutor = async (executable, args, options) => {
    const call = { executable, args, options }; calls.push(call);
    const handled = await handler?.(call); if (handled) return handled;
    if (args.includes('version')) return { exitCode: 0, stdout: '27.0.0\n', stderr: '' };
    if (args.includes('inspect')) return { exitCode: 0, stdout: imageId + '\n', stderr: '' };
    return { exitCode: 0, stdout: args.includes('start') ? 'ok\n' : '', stderr: '' };
  };
  return { calls, execute };
}
function baseManifest() { return { version: 1 as const, files: [
  { path: 'src/math.js', content: 'export const add = (a, b) => a - b;\n' },
  { path: 'package.json', content: '{"type":"module","scripts":{"test":"node --test"}}' },
] }; }
async function fixture(t: { after(fn: () => Promise<unknown>): unknown }) {
  const root = await mkdtemp(path.join(tmpdir(), 'tinkerfleet-runner-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/math.js'), 'export const add = (a, b) => a - b;\n');
  await writeFile(path.join(root, 'package.json'), '{"type":"module","scripts":{"test":"node --test"}}');
  const approvals = new ApprovalStore();
  const docker = fakeDocker();
  const runner = new SafeContainerRunner({ snapshotManifest: baseManifest(), approvals, executeProcess: docker.execute });
  return { root, approvals, docker, runner };
}

test('explicit executable/argv allowlist rejects host shell, flags, and path escapes', () => {
  for (const action of [
    { kind: 'command', executable: 'sh', args: ['-c', 'id'] },
    { kind: 'command', executable: 'node', args: ['-e', 'process.exit()'] },
    { kind: 'command', executable: 'node', args: ['--inspect'] },
    { kind: 'command', executable: 'npm', args: ['install'] },
    { kind: 'command', executable: 'cat', args: ['/etc/passwd'] },
    { kind: 'command', executable: 'ls', args: ['--help'] },
    { kind: 'command', executable: 'node', args: ['src/math.js;id'] },
    { kind: 'command', executable: 'node', args: ['--test'], env: { SECRET: 'value' } },
  ]) assert.throws(() => validateAction(action));
  for (const relative of ['../escape.js', '/etc/passwd', 'a/../../b', 'a\\b', 'a//b', 'a/.env', '.git/config', 'secrets/token.txt', 'id_rsa', 'key.pem', 'C:/x', 'a/./b', 'a\0b']) {
    assert.throws(() => validateRelativePath(relative));
  }
  assert.deepEqual(validateAction({ kind: 'command', executable: 'node', args: ['--test'] }), { kind: 'command', executable: 'node', args: ['--test'] });
});

test('snapshot excludes symlinks, hardlinks, hidden directories, credentials, binary, and dependencies', { skip: process.platform !== 'linux' }, async t => {
  const { root } = await fixture(t);
  const runner = new SafeContainerRunner({ workspaceRoot: root, executeProcess: fakeDocker().execute });
  for (const dir of ['.git', 'node_modules', 'secrets']) {
    await mkdir(path.join(root, dir)); await writeFile(path.join(root, dir, 'leak.js'), 'private');
  }
  await writeFile(path.join(root, '.env'), 'API_KEY=private');
  await writeFile(path.join(root, 'private.pem'), 'private');
  await writeFile(path.join(root, 'leak.js'), `const key = "sk-${'a'.repeat(40)}";`);
  await writeFile(path.join(root, 'binary.js'), Buffer.from([0, 1, 2, 255]));
  await symlink('/etc/passwd', path.join(root, 'escape.txt'));
  await symlink(path.join(root, 'src'), path.join(root, 'linked'));
  await writeFile(path.join(root, 'hard.txt'), 'hard link'); await link(path.join(root, 'hard.txt'), path.join(root, 'alias.txt'));
  const snapshot = await runner.snapshot('run-1');
  assert.deepEqual(snapshot.files, ['package.json', 'src/math.js']);
  assert.ok(snapshot.excluded.includes('escape.txt') && snapshot.excluded.includes('leak.js'));
  await assert.rejects(runner.readFile('run-1', 'escape.txt'), { code: 'FILE_NOT_FOUND' });
  await writeFile(path.join(root, 'src/math.js'), 'changed in original');
  assert.match(await runner.readFile('run-1', 'src/math.js'), /a - b/);
  assert.equal(await runner.readFile('run-2', 'src/math.js'), 'changed in original');
});

test('snapshot limits and symlink workspace root fail closed', { skip: process.platform !== 'linux' }, async t => {
  const { root, approvals, docker } = await fixture(t);
  await writeFile(path.join(root, 'large.txt'), 'x'.repeat(RUNNER_LIMITS.fileBytes + 1));
  const oversized = new SafeContainerRunner({ workspaceRoot: root, approvals, executeProcess: docker.execute });
  await assert.rejects(oversized.snapshot('run-1'), { code: 'SNAPSHOT_LIMIT' });
  const alias = root + '-alias'; await symlink(root, alias); t.after(() => rm(alias));
  const linked = new SafeContainerRunner({ workspaceRoot: alias, executeProcess: docker.execute });
  await assert.rejects(linked.snapshot('run-1'), { code: 'UNSAFE_WORKSPACE' });
});

test('unavailable Docker blocks commands and edits, never invokes a host fallback', async t => {
  const { root, approvals } = await fixture(t);
  const calls: Call[] = [];
  const runner = new SafeContainerRunner({ snapshotManifest: baseManifest(), approvals, executeProcess: async (executable, args, options) => {
    calls.push({ executable, args, options }); return { exitCode: null, stdout: '', stderr: '', error: 'ENOENT' };
  } });
  assert.equal((await runner.checkAvailability()).available, false);
  for (const action of [{ kind: 'command', executable: 'node', args: ['--test'] }, { kind: 'edit', path: 'src/math.js', content: 'replacement' }]) {
    const approval = await runner.prepare('run-1', action); approvals.approve(approval.id);
    await assert.rejects(runner.execute('run-1', approval.id), { code: 'DOCKER_UNAVAILABLE' });
    assert.equal(approvals.get(approval.id)?.status, 'consumed');
  }
  assert.match(await runner.readFile('run-1', 'src/math.js'), /a - b/);
  assert.ok(calls.every(call => call.executable === localDockerConnection().executable && !call.args.includes('start')));
});

test('Docker command has isolation flags, no binds or inherited secrets, bounded execution and cleanup', async t => {
  const { approvals, docker, runner, root } = await fixture(t);
  const approval = await runner.prepare('run-1', { kind: 'command', executable: 'node', args: ['--test'] });
  approvals.approve(approval.id);
  const result = await runner.execute('run-1', approval.id);
  assert.equal(result.status, 'completed'); assert.equal(result.cleanupSucceeded, true);
  const create = docker.calls.find(call => call.args.includes('create'))!;
  for (const flag of ['--pull=never', '--rm', '--network=none', '--read-only', '--user=65532:65532', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--pids-limit=64', '--memory=128m', '--memory-swap=128m', '--cpus=0.5', '--entrypoint=/usr/local/bin/node']) assert.ok(create.args.includes(flag), flag);
  assert.ok(create.args.includes(imageId));
  assert.equal(create.args.some(arg => arg.includes(root) || arg.startsWith('--mount') || arg === '-v' || arg.includes('docker.sock,target')), false);
  const start = docker.calls.find(call => call.args.includes('start'))!;
  assert.equal(start.options.timeoutMs, 15_000); assert.equal(start.options.maxOutputBytes, 64 * 1024);
  const payload = JSON.parse(start.options.input!);
  assert.deepEqual(payload.action, { kind: 'command', executable: 'node', args: ['--test'] });
  assert.ok(payload.files.some(([name]: string[]) => name === 'src/math.js'));
  assert.ok(docker.calls.some(call => call.args.includes('rm') && call.args.includes('--force')));
  await assert.rejects(runner.execute('run-1', approval.id), { code: 'UNKNOWN_ACTION' });
});

test('approved edits affect only per-run snapshots; subsequent commands receive edited content', async t => {
  const { root, approvals, docker, runner } = await fixture(t);
  const edit = await runner.prepare('run-1', { kind: 'edit', path: 'src/math.js', content: 'export const add = (a, b) => a + b;\n' });
  const stale = await runner.prepare('run-1', { kind: 'command', executable: 'node', args: ['--test'] });
  approvals.approve(edit.id); approvals.approve(stale.id);
  const result = await runner.execute('run-1', edit.id);
  assert.equal(result.status, 'completed'); assert.notEqual(result.snapshotDigest, edit.action.snapshotDigest);
  assert.match(await readFile(path.join(root, 'src/math.js'), 'utf8'), /a - b/);
  assert.match(await runner.readFile('run-1', 'src/math.js'), /a \+ b/);
  assert.match(await runner.readFile('run-2', 'src/math.js'), /a - b/);
  await assert.rejects(runner.execute('run-1', stale.id), { code: 'STALE_APPROVAL' });
  const command = await runner.prepare('run-1', { kind: 'command', executable: 'node', args: ['--test'] });
  approvals.approve(command.id); await runner.execute('run-1', command.id);
  const starts = docker.calls.filter(call => call.args.includes('start'));
  const payload = JSON.parse(starts.at(-1)!.options.input!);
  assert.match(payload.files.find(([name]: string[]) => name === 'src/math.js')[1], /a \+ b/);
});

test('unapproved and foreign-run actions cannot invoke Docker', async t => {
  const { runner, docker } = await fixture(t);
  const approval = await runner.prepare('run-1', { kind: 'command', executable: 'node', args: ['--test'] });
  await assert.rejects(runner.execute('run-2', approval.id), { code: 'UNKNOWN_ACTION' });
  await assert.rejects(runner.execute('run-1', approval.id), { code: 'NOT_APPROVED' });
  assert.equal(docker.calls.some(call => call.args.includes('create') || call.args.includes('start')), false);
});

test('cancellation rejects duplicate execution, aborts active process and removes container', async t => {
  const { root, approvals } = await fixture(t);
  let started!: () => void; const startSeen = new Promise<void>(resolve => { started = resolve; });
  const docker = fakeDocker(call => {
    if (call.args.includes('start')) return new Promise<ProcessResult>(resolve => {
      started(); call.options.signal?.addEventListener('abort', () => resolve({ exitCode: null, stdout: '', stderr: '', termination: 'cancelled' }), { once: true });
    });
  });
  const runner = new SafeContainerRunner({ snapshotManifest: baseManifest(), approvals, executeProcess: docker.execute });
  const approval = await runner.prepare('run-1', { kind: 'command', executable: 'node', args: ['--test'] }); approvals.approve(approval.id);
  const execution = runner.execute('run-1', approval.id); await startSeen;
  // A different prepared action in the same run must also be blocked while one is active.
  const second = await runner.prepare('run-1', { kind: 'command', executable: 'node', args: ['--version'] }); approvals.approve(second.id);
  await assert.rejects(runner.execute('run-1', second.id), { code: 'RUN_BUSY' });
  runner.cancel('run-1');
  const result = await execution; assert.equal(result.status, 'cancelled');
  assert.equal(approvals.get(second.id)?.status, 'denied');
  assert.ok(docker.calls.some(call => call.args.includes('rm')));
});

test('timeout, output cap, failed creation and cleanup failure are never successful edits', async t => {
  const { root } = await fixture(t);
  for (const termination of ['timeout', 'output_limit'] as const) {
    const approvals = new ApprovalStore();
    const docker = fakeDocker(call => call.args.includes('start') ? { exitCode: null, stdout: 'bounded', stderr: '', termination } : undefined);
    const runner = new SafeContainerRunner({ snapshotManifest: baseManifest(), approvals, executeProcess: docker.execute });
    const record = await runner.prepare('run-1', { kind: 'edit', path: 'src/math.js', content: 'replacement' }); approvals.approve(record.id);
    assert.equal((await runner.execute('run-1', record.id)).status, termination);
    assert.match(await runner.readFile('run-1', 'src/math.js'), /a - b/);
    assert.ok(docker.calls.some(call => call.args.includes('rm')));
  }
  for (const broken of ['create', 'rm']) {
    const approvals = new ApprovalStore();
    const docker = fakeDocker(call => call.args.includes(broken) ? { exitCode: 125, stdout: '', stderr: 'daemon failure' } : undefined);
    const runner = new SafeContainerRunner({ snapshotManifest: baseManifest(), approvals, executeProcess: docker.execute });
    const record = await runner.prepare('run-1', { kind: 'edit', path: 'src/math.js', content: 'replacement' }); approvals.approve(record.id);
    const result = await runner.execute('run-1', record.id); assert.equal(result.status, 'failed');
    assert.equal(result.cleanupSucceeded, broken !== 'rm');
    assert.match(await runner.readFile('run-1', 'src/math.js'), /a - b/);
  }
});

test('missing image does not pull, and disposed runs cannot be reopened', async t => {
  const { root } = await fixture(t);
  const docker = fakeDocker(call => call.args.includes('inspect') ? { exitCode: 1, stdout: '', stderr: 'not found' } : undefined);
  const runner = new SafeContainerRunner({ snapshotManifest: baseManifest(), executeProcess: docker.execute });
  assert.equal((await runner.checkAvailability()).available, false);
  assert.equal(docker.calls.some(call => call.args.includes('pull')), false);
  await runner.snapshot('run-1'); runner.disposeRun('run-1');
  await assert.rejects(runner.snapshot('run-1'), { code: 'RUN_CLOSED' });
});

test('subprocess transport enforces a shared byte limit and uses no shell or inherited environment', async () => {
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const { createProcessExecutor } = await import('../src/server/runner.js');
  let captured: Record<string, unknown> | undefined;
  let killed = 0;
  const spawn = ((_executable: unknown, _args: unknown, options: Record<string, unknown>) => {
    captured = options;
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      kill: () => { killed++; queueMicrotask(() => child.emit('close', null)); return true; },
    });
    queueMicrotask(() => { child.stdout.write(Buffer.alloc(20, 255)); child.stderr.write('more output'); });
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
  const result = await createProcessExecutor(spawn)('docker', ['version'], { timeoutMs: 500, maxOutputBytes: 12 });
  assert.equal(result.termination, 'output_limit'); assert.equal(killed, 1);
  assert.ok(Buffer.byteLength(result.stdout + result.stderr) <= 12);
  assert.equal(captured?.shell, false);
  assert.deepEqual(Object.keys(captured?.env as object).sort(), ['DOCKER_CONFIG', 'HOME', 'LANG', 'PATH']);
});

test('subprocess transport has bounded timeout, cancellation, and missing-binary handling', async () => {
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const { createProcessExecutor } = await import('../src/server/runner.js');
  for (const reason of ['timeout', 'cancelled', 'missing'] as const) {
    let killed = 0;
    const spawn = (() => {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
        kill: () => { killed++; queueMicrotask(() => child.emit('close', null)); return true; },
      });
      if (reason === 'missing') queueMicrotask(() => child.emit('error', new Error('ENOENT')));
      return child;
    }) as unknown as typeof import('node:child_process').spawn;
    const controller = new AbortController();
    const pending = createProcessExecutor(spawn)('docker', [], { timeoutMs: 5, maxOutputBytes: 20, signal: controller.signal });
    if (reason === 'cancelled') controller.abort();
    const result = await pending;
    if (reason === 'missing') { assert.equal(result.error, 'ENOENT'); assert.equal(killed, 0); }
    else { assert.equal(result.termination, reason); assert.equal(killed, 1); }
  }
});

test('cleanup failure blocks subsequent execution until operator restart', async t => {
  const { root, approvals } = await fixture(t);
  const docker = fakeDocker(call => call.args.includes('rm') ? { exitCode: 1, stdout: '', stderr: 'daemon unavailable' } : undefined);
  const runner = new SafeContainerRunner({ snapshotManifest: baseManifest(), approvals, executeProcess: docker.execute });
  const first = await runner.prepare('run-1', { kind: 'command', executable: 'node', args: ['--test'] }); approvals.approve(first.id);
  assert.equal((await runner.execute('run-1', first.id)).cleanupSucceeded, false);
  const second = await runner.prepare('run-1', { kind: 'command', executable: 'node', args: ['--test'] }); approvals.approve(second.id);
  await assert.rejects(runner.execute('run-1', second.id), { code: 'DOCKER_UNAVAILABLE' });
  assert.equal(docker.calls.filter(call => call.args.includes('start')).length, 1);
  assert.equal((await runner.checkAvailability()).available, false);
});

test('portable snapshot manifests are data only, deep-copied, and retain isolated approved edits', async () => {
  const original = { version: 1 as const, files: [{ path: 'sum.js', content: 'export const sum = (a,b) => a-b;' }] };
  const approvals = new ApprovalStore(); const docker = fakeDocker();
  const runner = new SafeContainerRunner({ snapshotManifest: original, approvals, executeProcess: docker.execute });
  original.files[0]!.content = 'caller mutation';
  assert.match(await runner.readFile('run-1', 'sum.js'), /a-b/);
  const approval = await runner.prepare('run-1', { kind: 'edit', path: 'sum.js', content: 'export const sum = (a,b) => a+b;' });
  approvals.approve(approval.id);
  assert.equal((await runner.execute('run-1', approval.id)).status, 'completed');
  assert.match(await runner.readFile('run-1', 'sum.js'), /a\+b/);
  assert.match(await runner.readFile('run-2', 'sum.js'), /a-b/);
  assert.equal((await runner.snapshot('run-1')).excluded.length, 0);
});

test('portable manifest validates every entry and never interprets archives or link metadata', async () => {
  const { parseSnapshotManifest } = await import('../src/server/runner.js');
  for (const candidate of [
    { version: 1, files: [{ path: '../escape.txt', content: 'secret' }] },
    { version: 1, files: [{ path: 'a.txt', content: 'safe', type: 'symlink', target: '/etc/passwd' }] },
    { version: 1, files: [{ path: '.env', content: 'private' }] },
    { version: 1, files: [{ path: 'private.pem', content: 'private' }] },
    { version: 1, files: [{ path: 'a.txt', content: 'one' }, { path: 'a.txt', content: 'two' }] },
    { version: 1, files: [{ path: 'a.txt', content: 'one' }, { path: 'a.txt/b.js', content: 'two' }] },
    { version: 1, files: [{ path: 'a.txt', content: '\ud800' }] },
    { version: 1, files: [{ path: 'a.txt', content: '\u0000' }] },
    { version: 1, files: [{ path: 'a.txt', content: `sk-${'a'.repeat(40)}` }] },
    { version: 1, files: [{ path: 'a.txt', content: 'x'.repeat(RUNNER_LIMITS.fileBytes + 1) }] },
    { version: 2, files: [] },
    { version: 1, files: [], symlinks: [] },
  ]) assert.throws(() => parseSnapshotManifest(candidate));
  const valid = parseSnapshotManifest('{"version":1,"files":[{"path":"sum.js","content":"ok"}]}');
  assert.ok(Object.isFrozen(valid) && Object.isFrozen(valid.files) && Object.isFrozen(valid.files[0]));
  assert.throws(() => new SafeContainerRunner({ workspaceRoot: '/tmp/a', snapshotManifest: valid }), { code: 'INVALID_SOURCE' });
});

test('macOS selects official Docker Desktop CLI and local socket, without remote contexts', async () => {
  const { localDockerConnection } = await import('../src/server/runner.js');
  assert.deepEqual(localDockerConnection('darwin', '/Users/example'), {
    executable: '/Applications/Docker.app/Contents/Resources/bin/docker',
    hostFlag: '--host=unix:///Users/example/.docker/run/docker.sock',
  });
  assert.deepEqual(localDockerConnection('linux', '/home/example'), { executable: 'docker', hostFlag: '--host=unix:///var/run/docker.sock' });
  assert.throws(() => localDockerConnection('win32'), { code: 'PLATFORM_UNSUPPORTED' });
});

test('approval binds immutable image ID and retagging cannot change its execution image', async () => {
  const approvals = new ApprovalStore();
  const otherImageId = 'sha256:' + 'b'.repeat(64);
  let retagged = false;
  const docker = fakeDocker(call => {
    if (call.args.includes('inspect')) return { exitCode: 0, stdout: call.args.at(-1) === 'node:24-alpine' && retagged ? otherImageId : imageId, stderr: '' };
  });
  const runner = new SafeContainerRunner({ snapshotManifest: { version: 1, files: [] }, approvals, executeProcess: docker.execute });
  const approval = await runner.prepare('run-1', { kind: 'command', executable: 'node', args: ['--version'] });
  assert.equal(approval.action.imageId, imageId);
  approvals.approve(approval.id); retagged = true;
  assert.equal((await runner.execute('run-1', approval.id)).status, 'completed');
  assert.ok(docker.calls.find(call => call.args.includes('create'))!.args.includes(imageId));
  assert.equal(docker.calls.find(call => call.args.includes('create'))!.args.includes(otherImageId), false);
  assert.ok(docker.calls.filter(call => call.args.includes('inspect')).at(-1)!.args.includes(imageId));
});

test('cancel during asynchronous preparation cannot resurrect a grant', async () => {
  const approvals = new ApprovalStore(); const docker = fakeDocker();
  const runner = new SafeContainerRunner({ snapshotManifest: { version: 1, files: [] }, approvals, executeProcess: docker.execute });
  const pending = runner.prepare('run-1', { kind: 'command', executable: 'node', args: ['--version'] });
  runner.cancel('run-1');
  await assert.rejects(pending, { code: 'RUN_CLOSED' });
  await assert.rejects(runner.prepare('run-1', { kind: 'command', executable: 'node', args: ['--version'] }), { code: 'RUN_CLOSED' });
  assert.equal(docker.calls.some(call => call.args.includes('create') || call.args.includes('start')), false);
});

test('shutdown waits for container removal and cannot start another action', async () => {
  const approvals = new ApprovalStore();
  let startSeen!: () => void; const started = new Promise<void>(resolve => { startSeen = resolve; });
  let cleanupSeen!: () => void; const cleaning = new Promise<void>(resolve => { cleanupSeen = resolve; });
  let finishCleanup!: () => void;
  const docker = fakeDocker(call => {
    if (call.args.includes('start')) return new Promise<ProcessResult>(resolve => {
      startSeen(); call.options.signal!.addEventListener('abort', () => resolve({ exitCode: null, stdout: '', stderr: '', termination: 'cancelled' }), { once: true });
    });
    if (call.args.includes('rm')) return new Promise<ProcessResult>(resolve => {
      cleanupSeen(); finishCleanup = () => resolve({ exitCode: 0, stdout: '', stderr: '' });
    });
  });
  const runner = new SafeContainerRunner({ snapshotManifest: baseManifest(), approvals, executeProcess: docker.execute });
  const grant = await runner.prepare('run-1', { kind: 'command', executable: 'node', args: ['--test'] }); approvals.approve(grant.id);
  const execution = runner.execute('run-1', grant.id); await started;
  let drained = false;
  const shutdown = runner.shutdown().then(result => { drained = true; return result; });
  await cleaning;
  assert.equal(drained, false);
  await assert.rejects(runner.prepare('run-new', { kind: 'command', executable: 'node', args: ['--version'] }), { code: 'RUN_CLOSED' });
  finishCleanup();
  assert.equal((await shutdown).cleanupSucceeded, true);
  assert.equal((await execution).status, 'cancelled');
  assert.equal(drained, true);
});
