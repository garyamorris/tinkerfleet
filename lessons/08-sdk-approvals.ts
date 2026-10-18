/** Lesson 8: how the SDK pauses a run for approval, then resumes it approved or rejected. */
import assert from 'node:assert/strict';
import { Agent, Runner, tool } from '@openai/agents';
import { ScriptedModel, assistantMessage, functionCall } from '@openai/agents/testing';
import { z } from 'zod';

// needsApproval makes the SDK stop before execute runs, and hand control back to you.
const deleted: string[] = [];
const deleteNote = tool({
  name: 'delete_note',
  description: 'Delete a saved note by title.',
  parameters: z.object({ title: z.string() }),
  needsApproval: true,
  execute: async ({ title }) => {
    deleted.push(title);
    return `Deleted ${title}.`;
  },
});

async function attempt(approve: boolean) {
  const model = new ScriptedModel([
    [functionCall('delete_note', { title: 'groceries' }, { callId: 'delete-1' })],
    [assistantMessage(approve ? 'I deleted the groceries note.' : 'Okay, I kept it.')],
  ]);
  const agent = new Agent({
    name: 'notes',
    instructions: 'Manage notes.',
    model,
    tools: [deleteNote],
  });
  const runner = new Runner({ tracingDisabled: true });

  // 1. The run pauses instead of finishing. Nothing has been deleted yet.
  let result = await runner.run(agent, 'Delete my groceries note.');
  assert.equal(result.interruptions.length, 1);
  const pending = result.interruptions[0];
  console.log(`  paused for approval: ${pending.name}(${pending.arguments})`);

  // 2. Your application shows the exact call to a person and records the decision.
  if (approve) result.state.approve(pending);
  else result.state.reject(pending, { message: 'The user declined this action.' });

  // 3. Resume the same run from its saved state.
  result = await runner.run(agent, result.state);
  const seen = model.calls[1].request.input as { type: string; output?: { text?: string } }[];
  return { final: result.finalOutput, toolResult: seen.at(-1)?.output?.text };
}

const approved = await attempt(true);
assert.deepEqual(deleted, ['groceries']);
assert.equal(approved.toolResult, 'Deleted groceries.');
console.log(`  approved → the tool ran; the model said: ${approved.final}`);

const rejected = await attempt(false);
assert.deepEqual(deleted, ['groceries'], 'a rejected call never runs');
assert.equal(rejected.toolResult, 'The user declined this action.');
console.log(`  rejected → the tool did not run; the model received: "${rejected.toolResult}"`);

console.log(
  '8. Approvals: the SDK pauses, your app decides, and the run resumes from saved state.',
);
console.log(
  'Exercise: find result.interruptions, state.approve and state.reject in src/server/sdk/adapter.ts.',
);
