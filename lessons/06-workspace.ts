/** Lesson 6: capture a real filtered snapshot of a throwaway synthetic project. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SafeContainerRunner, RunnerError, parseSnapshotManifest } from '../src/server/runner.js';

// Keep the checked-in portable example honest: it matches four explicit public files.
const bundled = parseSnapshotManifest(await readFile(new URL('../examples/tiny-project.snapshot.json', import.meta.url), 'utf8'));
assert.deepEqual(bundled.files.map(file => file.path).sort(), ['README.md', 'package.json', 'sum.js', 'sum.test.js']);
for (const file of bundled.files) {
  assert.equal(file.content, await readFile(new URL(`../examples/tiny-project/${file.path}`, import.meta.url), 'utf8'));
}

// Portable input contains file data, never permission to open these host paths.
const input = { version: 1, files: [{ path: 'sum.js', content: 'export const sum = (a, b) => a - b;\n' }] };
const manifest = parseSnapshotManifest(input);
input.files[0]!.content = 'Changed caller-owned input.';
assert.ok(Object.isFrozen(manifest));
assert.ok(Object.isFrozen(manifest.files));
assert.match(manifest.files[0]!.content, /a - b/);
for (const files of [
  [{ path: '../outside.js', content: 'invalid' }],
  [{ path: '.env', content: 'invalid' }],
  [{ path: 'a.js', content: 'a' }, { path: 'a.js', content: 'duplicate' }],
  [{ path: 'a.js', content: 'a' }, { path: 'a.js/b.js', content: 'conflict' }],
  [{ path: 'alias.js', content: '', symlink: '/outside.js' }],
]) assert.throws(() => parseSnapshotManifest({ version: 1, files }));
let processCalls = 0;
const neverExecute = async () => {
  processCalls++;
  throw new Error('This lesson must never launch a process.');
};
const portable = new SafeContainerRunner({ snapshotManifest: manifest, executeProcess: neverExecute });
assert.deepEqual((await portable.snapshot('manifest-run')).files, ['sum.js']);
assert.match(await portable.readFile('manifest-run', 'sum.js'), /a - b/);
portable.disposeRun('manifest-run');
console.log('6. Manifest: validated explicit file content; rejected traversal, duplicates, links, and conflicts.');

const root = await mkdtemp(path.join(tmpdir(), 'tinkerfleet-lesson-'));
try {
  await writeFile(path.join(root, 'sum.js'), 'export const sum = (a, b) => a - b;\n');
  await writeFile(path.join(root, '.env'), 'LESSON_PLACEHOLDER=not-a-real-secret\n');
  await mkdir(path.join(root, 'node_modules'));
  await writeFile(path.join(root, 'node_modules', 'ignored.js'), 'Ignored dependency fixture.');

  // An injected executor makes any accidental process launch fail this lesson.
  const runner = new SafeContainerRunner({ workspaceRoot: root, executeProcess: neverExecute });

  if (process.platform !== 'linux') {
    // The real snapshotter uses Linux descriptor-anchored reads. No unsafe fallback.
    await assert.rejects(runner.snapshot('lesson-run'), (error: unknown) =>
      error instanceof RunnerError && error.code === 'PLATFORM_UNSUPPORTED');
    console.log('6. Workspace: this platform correctly rejects Linux-only secure snapshot capture.');
    console.log('The portable manifest above still works. Direct directory capture needs Linux.');
  } else {
    await symlink(path.join(root, 'sum.js'), path.join(root, 'alias.js'));
    const snapshot = await runner.snapshot('lesson-run');
    assert.deepEqual(snapshot.files, ['sum.js']);
    assert.ok(snapshot.excluded.includes('.env'));
    assert.ok(snapshot.excluded.includes('node_modules'));
    assert.ok(snapshot.excluded.includes('alias.js'));
    const captured = await runner.readFile('lesson-run', 'sum.js');
    assert.match(captured, /a - b/);
    await assert.rejects(runner.readFile('lesson-run', '.env'));
    await assert.rejects(runner.readFile('lesson-run', '../outside.js'));

    // A run is a captured view, not a live filesystem mount.
    await writeFile(path.join(root, 'sum.js'), 'export const sum = (a, b) => a + b;\n');
    assert.equal(await runner.readFile('lesson-run', 'sum.js'), captured);
    assert.match(await readFile(path.join(root, 'sum.js'), 'utf8'), /a \+ b/);
    const next = await runner.snapshot('fresh-run');
    assert.notEqual(next.digest, snapshot.digest);
    assert.match(await runner.readFile('fresh-run', 'sum.js'), /a \+ b/);
    runner.disposeRun('lesson-run');
    await assert.rejects(runner.snapshot('lesson-run'));
    runner.disposeRun('fresh-run');
    console.log('6. Workspace: copied only allowed text; rejected symlinks, hidden files, and traversal.');
    console.log('The old run stayed unchanged when the synthetic source changed; a new run saw the update.');
  }
  assert.equal(processCalls, 0);
  console.log('No model calls, Docker commands, or real-project edits.');
  console.log('Exercise: add a binary fixture or hard link and assert that it is excluded.');
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log('Temporary fixture removed.');
