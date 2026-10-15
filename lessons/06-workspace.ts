/** Lesson 6: inspect a small selected folder, excluding unsafe input. */
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,rm,symlink,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {NativeWorkspaceRunner} from '../src/server/native-runner.js';

const root=await realpath(await mkdtemp(path.join(tmpdir(),'tinkerfleet-workspace-lesson-')));
const runner=new NativeWorkspaceRunner({workspaceRoot:root});
try {
  await writeFile(path.join(root,'sum.js'),'export const sum = (a,b) => a-b;\n');
  await writeFile(path.join(root,'.env'),'LESSON_PLACEHOLDER=not-a-real-secret\n');
  await mkdir(path.join(root,'node_modules'));
  await writeFile(path.join(root,'node_modules','ignored.js'),'Ignored dependency fixture.');
  await symlink(path.join(root,'sum.js'),path.join(root,'alias.js'));
  await writeFile(path.join(root,'linked.txt'),'Synthetic linked file.');
  await link(path.join(root,'linked.txt'),path.join(root,'another-link.txt'));
  const before=await runner.snapshot('lesson-read');
  assert.deepEqual(before.files,['sum.js']);
  assert.match(await runner.readFile('lesson-read','sum.js'),/a-b/);
  await assert.rejects(runner.readFile('lesson-read','.env'));
  await assert.rejects(runner.readFile('lesson-read','../outside.js'));
  await assert.rejects(runner.readFile('lesson-read','alias.js'));
  await writeFile(path.join(root,'sum.js'),'export const sum = (a,b) => a+b;\n');
  const after=await runner.snapshot('fresh-read');
  assert.notEqual(before.digest,after.digest);
  console.log('6. Workspace: read allowed source, excluded hidden files, dependencies, symlinks and hard links.');
  console.log('A new capture detects changed source. Approvals are tied to the reviewed folder state.');
  console.log('These checks limit the file tools; approved commands still run with your user permissions.');
  console.log('No model calls or command execution. Temporary fixture removed on exit.');
} finally {
  await runner.shutdown();
  await rm(root,{recursive:true,force:true});
}
