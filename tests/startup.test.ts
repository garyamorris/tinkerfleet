import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const entry = fileURLToPath(new URL('../src/server/index.ts', import.meta.url));
const tsx = import.meta.resolve('tsx');

/** Start the real server entry point in its own folder and collect how it stopped. */
async function start(env: Record<string, string>, cwd: string) {
  const child = spawn(process.execPath, ['--import', tsx, entry, '--production'], {
    cwd,
    env: { PATH: process.env.PATH, TINKERFLEET_MODE: 'demo', ...env },
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.stdout.resume();
  const timeout = setTimeout(() => child.kill('SIGKILL'), 20_000);
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
  clearTimeout(timeout);
  return { code, stderr };
}
const oneLine = (stderr: string) => {
  assert.equal(stderr.trim().split('\n').length, 1, `expected one line, got:\n${stderr}`);
  assert.ok(!/\n\s+at /.test(stderr), 'no stack trace');
  return stderr.trim();
};

test('startup problems are explained in one line, not a stack trace', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tinkerfleet-startup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  await t.test('an invalid port', async () => {
    const { code, stderr } = await start({ TINKERFLEET_PORT: '80' }, dir);
    assert.equal(code, 1);
    assert.match(oneLine(stderr), /^Tinkerfleet could not start\. Choose a valid local port/);
  });

  await t.test('an invalid setting', async () => {
    const { code, stderr } = await start(
      { TINKERFLEET_PORT: '45348', TINKERFLEET_MAX_RUN_MS: 'soon' },
      dir,
    );
    assert.equal(code, 1);
    assert.match(oneLine(stderr), /TINKERFLEET_MAX_RUN_MS must be an integer/);
  });

  await t.test('a saved history that cannot be read safely', async () => {
    await mkdir(path.join(dir, '.tinkerfleet'), { recursive: true });
    const saved = path.join(dir, '.tinkerfleet', 'conversations.json');
    await writeFile(saved, '{"truncated');
    const { code, stderr } = await start({ TINKERFLEET_PORT: '45349' }, dir);
    assert.equal(code, 1);
    assert.match(oneLine(stderr), /Conversation history could not be read safely/);
    assert.equal(await readFile(saved, 'utf8'), '{"truncated', 'the saved file is left unchanged');
    await rm(path.join(dir, '.tinkerfleet'), { recursive: true, force: true });
  });

  await t.test('a port that is already in use', async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(45350, '127.0.0.1', resolve));
    try {
      const { code, stderr } = await start({ TINKERFLEET_PORT: '45350' }, dir);
      assert.equal(code, 1);
      assert.match(oneLine(stderr), /Port 45350 is already in use/);
    } finally {
      await new Promise((resolve) => taken.close(resolve));
    }
  });
});
