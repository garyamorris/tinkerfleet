/** Lesson 12: give each bot only the tools its work needs; the server's switches cap them all. */
import assert from 'node:assert/strict';
import { tool } from '@openai/agents';
import { ScriptedModel, functionCall } from '@openai/agents/testing';
import { z } from 'zod';
import { createFleetAgents, createSdkAdapter, type SdkHarness } from '../src/server/sdk.js';
import { canLeakWorkspace, splitCreatedCapabilities } from '../src/shared/capabilities.js';
import type { Capability, Persona } from '../src/shared/types.js';

// Synthetic stand-ins with the real tool names. None of them is ever invoked.
const stub = (name: string) =>
  tool({
    name,
    description: `Synthetic ${name}.`,
    parameters: z.object({}).strict(),
    execute: async () => 'never called',
  });
const bot = (id: string, capabilities?: Capability[]): Persona => ({
  id,
  role: 'agent',
  name: id[0].toUpperCase() + id.slice(1),
  purpose: `Work as ${id}.`,
  color: '#567a75',
  shape: 'orbit',
  ...(capabilities ? { capabilities } : {}),
});
const team = [
  bot('scout', ['web', 'memory']),
  bot('maker', ['read', 'edit', 'memory']),
  bot('checker', ['read', 'run', 'memory']),
  bot('veteran'), // Saved before capabilities existed: it keeps every enabled tool.
];
const build = (webSearchEnabled: boolean) =>
  createFleetAgents({
    model: 'lesson-no-inference',
    team,
    webSearchEnabled,
    workspaceToolsEnabled: true,
    readTools: [stub('list_files'), stub('read_file')],
    mutationTools: [stub('edit_file')],
    commandTools: [stub('run_command')],
    memoryTools: () => [stub('recall_memory')],
  });
const names = (fleet: ReturnType<typeof build>, id: string) => fleet[id].tools.map((t) => t.name);

// A. Each profile picks groups of tools. The agent receives those and nothing else.
const fleet = build(true);
assert.deepEqual(names(fleet, 'scout'), ['web_search', 'recall_memory']);
assert.deepEqual(names(fleet, 'maker'), ['list_files', 'read_file', 'edit_file', 'recall_memory']);
assert.deepEqual(names(fleet, 'checker'), [
  'list_files',
  'read_file',
  'run_command',
  'recall_memory',
]);
assert.equal(names(fleet, 'veteran').length, 6);

// B. The server's switches cap every profile. With web search off, Scout keeps only memory.
assert.deepEqual(names(build(false), 'scout'), ['recall_memory']);

// C. Read and web together can leak files, so no starter bot has both.
assert.ok(team.slice(0, 3).every((p) => !canLeakWorkspace(p.capabilities!)));
assert.ok(canLeakWorkspace(['read', 'web']));

// D. A bot the primary creates is not reviewed first. It starts with what is safe to give
// unasked; run waits until the user grants it from the creation message or the Bot library.
assert.deepEqual(splitCreatedCapabilities(['read', 'run']), {
  granted: ['read'],
  needsUser: ['run'],
});
assert.deepEqual(splitCreatedCapabilities(['web', 'memory']).needsUser, []);

// E. Instructions are not enforcement. A model that asks Checker for edit_file gets an error,
// and the workspace is never touched, because the tool was never given to it.
const touched: string[] = [];
// Every workspace operation is recorded. Cancelling (cleanup after the error) is allowed.
const harness = new Proxy({} as SdkHarness, {
  get: (_target, key) => () => {
    if (key === 'cancel') return;
    touched.push(String(key));
    throw new Error('The lesson harness is never used.');
  },
});
const model = new ScriptedModel([
  [functionCall('edit_file', { path: 'sum.js', content: 'x' }, { callId: 'not-mine' })],
]);
const done = await createSdkAdapter({ harness, model, webSearchEnabled: false }).start({
  runId: 'lesson-least-privilege',
  prompt: 'Change sum.js.',
  team: [team[2]],
});
assert.equal(done.status, 'error');
assert.deepEqual(
  model.calls[0].request.tools.map((t) => t.name),
  ['list_files', 'read_file', 'run_command'],
);
assert.deepEqual(touched, []);

console.log('12. Least privilege: each bot gets only the tools its profile asks for,');
console.log('and only those the server enables. A tool never given cannot be called.');
console.log('No model was called. Exercise: give Scout read too. Which check fails, and why?');
