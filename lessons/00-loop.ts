/** Lesson 0: watch the agent loop run — model, tool call, result, model — with no API key. */
import assert from 'node:assert/strict';
import { Agent, Runner, tool } from '@openai/agents';
import { ScriptedModel, assistantMessage, functionCall } from '@openai/agents/testing';
import { z } from 'zod';

// Part A: the loop by hand. A "model" is anything that reads the transcript and
// chooses a next step: either call a tool or give a final answer.
type Step = { tool: string; args: { a: number; b: number } } | { answer: string };
const tools: Record<string, (args: { a: number; b: number }) => string> = {
  add: ({ a, b }) => String(a + b),
};
function fakeModel(transcript: string[]): Step {
  const result = transcript.findLast(line => line.startsWith('tool result: '));
  if (!result) return { tool: 'add', args: { a: 2, b: 3 } };
  return { answer: `2 + 3 = ${result.slice('tool result: '.length)}` };
}

const transcript = ['user: What is 2 + 3?'];
let answer: string | undefined;
for (let turn = 1; turn <= 5 && answer === undefined; turn++) {
  const step = fakeModel(transcript);
  if ('answer' in step) {
    answer = step.answer;
    console.log(`  turn ${turn}: model answered "${answer}"`);
  } else {
    // The model only asked. Your application decides whether and how the tool runs.
    const output = tools[step.tool](step.args);
    console.log(`  turn ${turn}: model asked for ${step.tool}(${JSON.stringify(step.args)}); app ran it → ${output}`);
    transcript.push(`tool call: ${step.tool}(${JSON.stringify(step.args)})`, `tool result: ${output}`);
  }
}
assert.equal(answer, '2 + 3 = 5');
assert.equal(transcript.length, 3);

// Part B: the same loop run by the OpenAI Agents SDK. ScriptedModel returns one
// prepared response per model call, so nothing is sent over the network.
const ran: { a: number; b: number }[] = [];
const add = tool({
  name: 'add',
  description: 'Add two numbers.',
  parameters: z.object({ a: z.number(), b: z.number() }),
  execute: async ({ a, b }) => {
    ran.push({ a, b });
    return String(a + b);
  },
});
const model = new ScriptedModel([
  [functionCall('add', { a: 2, b: 3 }, { callId: 'call_1' })], // model call 1: ask for a tool
  [assistantMessage('2 + 3 = 5')],                             // model call 2: answer
]);
const agent = new Agent({ name: 'calculator', instructions: 'Use tools for arithmetic.', model, tools: [add] });
const result = await new Runner({ tracingDisabled: true }).run(agent, 'What is 2 + 3?');

assert.deepEqual(ran, [{ a: 2, b: 3 }]); // our code ran the tool exactly once
assert.equal(result.finalOutput, '2 + 3 = 5');
assert.equal(model.calls.length, 2);
model.assertComplete();

// The model is stateless. Call 2 only "knows" the result because the SDK resent
// the whole transcript: the user message, the tool call, and the tool's output.
const secondInput = model.calls[1].request.input as { type: string; output?: { text?: string } }[];
assert.deepEqual(secondInput.map(item => item.type), ['message', 'function_call', 'function_call_result']);
assert.equal(secondInput[2].output?.text, '5');
console.log(`  SDK: model call 2 received [${secondInput.map(item => item.type).join(', ')}]`);
console.log(`  SDK: run items were [${result.newItems.map(item => item.type).join(', ')}]`);

console.log('0. The loop: model asks, your code runs the tool, the result goes back, the model answers.');
console.log('Exercise: script a second add call before the answer. Predict model.calls.length and ran, then run it.');
