/** Lesson 5: inspect the exact real launch plan, without starting Docker. */
import assert from 'node:assert/strict';
import { buildDockerCreateArgs, localDockerConnection, RUNNER_LIMITS } from '../src/server/runner.js';

const imageId = 'sha256:' + 'a'.repeat(64); // Synthetic ID, never executed.
const args = buildDockerCreateArgs('tinkerfleet-0001', imageId);
for (const required of [
  'create', '--pull=never', '--network=none', '--read-only', '--user=65532:65532',
  '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--pids-limit=64',
  '--memory=128m', '--memory-swap=128m', '--cpus=0.5',
  '--ipc=none', '--cgroupns=private', '--log-driver=none', '--ulimit=core=0:0',
]) assert.ok(args.includes(required), `Missing boundary: ${required}`);
assert.ok(args.includes('--host=unix:///var/run/docker.sock'));
assert.ok(args.includes(imageId));
assert.ok(args.some(arg => arg.startsWith('--tmpfs=/workspace:')));
assert.ok(!args.some(arg => arg === '-v' || arg === '--volume' || arg.startsWith('--mount')));
assert.ok(!args.some(arg => arg === '--privileged' || arg.startsWith('--network=host')));
assert.ok(!args.some(arg => arg === '--env' || arg.startsWith('--env=') || arg.startsWith('--env-file')));
assert.equal(RUNNER_LIMITS.timeoutMs, 15_000);
assert.equal(RUNNER_LIMITS.outputBytes, 64 * 1024);
assert.throws(() => buildDockerCreateArgs('untrusted-container-name', imageId));
assert.throws(() => buildDockerCreateArgs('tinkerfleet-0001', 'node:latest'));

// These connection helpers are pure. Neither platform is contacted.
assert.equal(localDockerConnection('linux').hostFlag, '--host=unix:///var/run/docker.sock');
assert.deepEqual(localDockerConnection('darwin', '/Users/lesson'), {
  executable: '/Applications/Docker.app/Contents/Resources/bin/docker',
  hostFlag: '--host=unix:///Users/lesson/.docker/run/docker.sock',
});
assert.throws(() => localDockerConnection('win32'));

console.log('5. Sandbox: inspected the actual Docker argument builder; no Docker process started.');
console.log('Non-root, no network, read-only root, no host mounts, local image ID, and bounded resources.');
console.log('This verifies the launch contract, not a real container or a proof against kernel exploits.');
console.log('Exercise: find why noexec on tmpfs does not prevent node from interpreting a JavaScript file.');
