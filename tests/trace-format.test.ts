import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contextSummary,
  outcomeText,
  readableText,
  resendShare,
  totalTokens,
} from '../src/client/trace-format.js';
import type { TraceCall, TraceItem } from '../src/shared/types.js';

const item = (kind: TraceItem['kind'], extra: Partial<TraceItem> = {}): TraceItem => ({
  kind,
  chars: 1,
  ...extra,
});
const call = (over: Partial<TraceCall> = {}): TraceCall => ({
  index: 1,
  agent: 'orbit',
  at: 0,
  durationMs: 100,
  instructions: '',
  instructionsChars: 0,
  tools: [],
  settings: {},
  context: {
    chars: 2_500,
    charsBefore: 2_500,
    budget: 10_000,
    removedItems: 0,
    trimmedToolOutputs: 0,
  },
  input: [],
  omittedItems: 0,
  output: [],
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  ...over,
});

test('the context meter reports how full the window was and what trimming did', () => {
  assert.deepEqual(contextSummary(call()), {
    percent: 25,
    notes: ['2,500 of 10,000 characters allowed'],
  });
  const trimmed = contextSummary(
    call({
      context: {
        chars: 9_000,
        charsBefore: 14_000,
        budget: 10_000,
        removedItems: 1,
        trimmedToolOutputs: 2,
      },
      omittedItems: 3,
    }),
  );
  assert.equal(trimmed.percent, 90);
  assert.match(
    trimmed.notes.join('\n'),
    /1 older item was dropped to fit \(14,000 characters before trimming\)/,
  );
  assert.match(trimmed.notes.join('\n'), /2 long tool outputs were shortened/);
  assert.match(trimmed.notes.join('\n'), /3 oldest items are not shown/);
  assert.equal(
    contextSummary(call({ context: { ...call().context, chars: 20_000 } })).percent,
    100,
    'the meter never overflows',
  );
  assert.equal(contextSummary(call({ context: { ...call().context, budget: 0 } })).percent, 0);
});

test('each call is described by what the model did with the request', () => {
  assert.equal(outcomeText(call({ output: [item('assistant')] })), 'replied');
  assert.equal(
    outcomeText(
      call({
        output: [
          item('tool_call', { name: 'read_file' }),
          item('tool_call', { name: 'list_files' }),
        ],
      }),
    ),
    'called read_file, list_files',
  );
  assert.equal(
    outcomeText(call({ output: [item('hosted_tool', { name: 'web_search_call' })] })),
    'called web_search_call',
  );
  assert.equal(outcomeText(call({ output: [item('reasoning')] })), 'returned nothing visible');
  assert.equal(outcomeText(call({ error: 'x' })), 'failed');
});

test('the resend share counts only items that had something to be compared with', () => {
  assert.equal(
    resendShare([call({ input: [item('user')] })]),
    null,
    'a first call has no baseline',
  );
  const calls = [
    call({ input: [item('user')] }),
    call({
      index: 2,
      input: [
        item('user', { fresh: false }),
        item('tool_call', { fresh: true }),
        item('tool_result', { fresh: true }),
        item('user', { fresh: false }),
      ],
    }),
  ];
  assert.equal(resendShare(calls), 50);
  assert.deepEqual(totalTokens([...calls, call({ usage: null })]), { input: 20, output: 10 });
});

test('tool-call arguments are indented only when the whole text is intact JSON', () => {
  const args = (text: string, chars = text.length): TraceItem => ({
    kind: 'tool_call',
    text,
    chars,
  });
  assert.equal(readableText(args('{"path":"a.js"}')), '{\n  "path": "a.js"\n}');
  assert.equal(
    readableText(args('{"path":"a.j', 500)),
    '{"path":"a.j',
    'cut text is left as it is',
  );
  assert.equal(readableText(args('not json')), 'not json');
  assert.equal(readableText(args('42')), '42');
  assert.equal(readableText({ kind: 'tool_result', text: '{"a":1}', chars: 7 }), '{"a":1}');
  assert.equal(readableText({ kind: 'reasoning', chars: 0 }), '');
});
