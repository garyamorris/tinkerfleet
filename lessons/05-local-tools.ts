/** Lesson 5: approve one real edit in a temporary teaching folder. No API key needed. */
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ApprovalStore } from '../src/server/approval.js';
import { NativeWorkspaceRunner } from '../src/server/native-runner.js';

const root = await realpath(await mkdtemp(path.join(tmpdir(), 'tinkerfleet-local-lesson-')));
const approvals = new ApprovalStore();
const runner = new NativeWorkspaceRunner({ workspaceRoot: root, approvals });
try {
  await writeFile(path.join(root, 'sum.js'), 'export const sum = (a,b) => a-b;\n');
  const edit = await runner.prepare('lesson-edit', {
    kind: 'edit',
    path: 'sum.js',
    content: 'export const sum = (a,b) => a+b;\n',
  });
  await assert.rejects(runner.execute('lesson-edit', edit.id));
  assert.match(await readFile(path.join(root, 'sum.js'), 'utf8'), /a-b/);
  approvals.approve(edit.id);
  assert.equal((await runner.execute('lesson-edit', edit.id)).status, 'completed');
  assert.match(await readFile(path.join(root, 'sum.js'), 'utf8'), /a\+b/);
  await assert.rejects(runner.execute('lesson-edit', edit.id));
  const create = await runner.prepare('lesson-create', {
    kind: 'edit',
    path: 'notes/results/result.txt',
    content: 'Created after approval.\n',
  });
  approvals.approve(create.id);
  assert.equal((await runner.execute('lesson-create', create.id)).status, 'completed');
  const command = await runner.prepare('lesson-command', {
    kind: 'command',
    executable: process.execPath,
    args: ['-e', 'console.log(require("node:fs").readFileSync("notes/results/result.txt","utf8"))'],
  });
  console.log('Review this teaching command:', JSON.stringify(command.action));
  await assert.rejects(runner.execute('lesson-command', command.id));
  approvals.approve(command.id);
  assert.match(
    (await runner.execute('lesson-command', command.id)).stdout,
    /Created after approval/,
  );
  console.log(
    '5. Local tools: an approved edit changed a real file; unapproved and repeated execution were rejected.',
  );
  console.log(
    'The chosen folder is not an OS sandbox. Approved commands run with your user permissions.',
  );
  console.log(
    'An approved create made nested directories; an approved local Node command read the new file.',
  );
  console.log(
    'No model request. All file changes and command input stayed in a temporary teaching fixture.',
  );
} finally {
  await runner.shutdown();
  await rm(root, { recursive: true, force: true });
}
