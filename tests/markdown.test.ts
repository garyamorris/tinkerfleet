import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageText, MessageSources } from '../src/client/citations';
import { RunActivity } from '../src/client/run-activity';
import type { Run } from '../src/shared/types';
const render = (text: string) => renderToStaticMarkup(React.createElement(MessageText, { text }));
test('Markdown renders structure, code and GFM tables without raw punctuation', () => {
  const html = render(
    '# Heading\n\n**Strong** and `code`\n\n- One\n- Two\n\n```js\nconst value = 1;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |',
  );
  for (const tag of ['<h1>', '<strong>', '<code>', '<ul>', '<pre>', '<table>', '<th>'])
    assert.ok(html.includes(tag), tag);
  assert.ok(html.includes('const value = 1;'));
});
test('unsafe links and raw HTML never execute; images do not fetch remote resources', () => {
  const html = render(
    '[Bad](javascript:alert%281%29) [Data](data:text/html,test) [Good](https://example.com) ![Diagram](https://example.com/tracker.png)\n\n<script>alert(1)</script>',
  );
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes('href="data:'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('href="https://example.com/"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('[Image: Diagram]'));
});
test('citations never change fenced or inline code and remain available in source list', () => {
  const text = '`literal`\n\n```js\nconst x = 1;\n```';
  const sources = [
    { url: 'https://example.com', title: 'Source', startIndex: 1, endIndex: 4 },
    { url: 'https://example.com/two', title: 'Two', startIndex: 18, endIndex: 23 },
  ];
  const html = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(MessageText, { text, sources }),
      React.createElement(MessageSources, { sources }),
    ),
  );
  assert.ok(!html.includes('inline-citation'));
  assert.ok(html.includes('<code>literal</code>'));
  assert.ok(html.includes('const x = 1;'));
  assert.ok(html.includes('Sources for this reply'));
});
test('activity displays only recorded tool steps with native expandable details', () => {
  const run = {
    status: 'running',
    activeAgent: 'a',
    events: [
      {
        id: 'e',
        at: 1000,
        agent: 'a',
        kind: 'tool',
        title: 'Reading a workspace file',
        detail: 'read_file',
      },
    ],
    startedAt: 0,
  } as Run;
  const html = renderToStaticMarkup(
    React.createElement(RunActivity, { run, nameFor: () => 'Ada' }),
  );
  assert.ok(html.includes('<details'));
  assert.ok(html.includes('<summary>'));
  assert.ok(html.includes('Reading a workspace file'));
  assert.ok(html.includes('Ada · +1.0s'));
  assert.ok(!html.includes('Searching'));
});

test('credential-bearing web links and sources are never clickable', () => {
  const text = '[Unsafe](https://user:password@example.com/path)';
  const sources = [
    { url: 'https://user:password@example.com/path', title: 'Unsafe', startIndex: 0, endIndex: 4 },
  ];
  const html = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(MessageText, { text, sources }),
      React.createElement(MessageSources, { sources }),
    ),
  );
  assert.ok(!html.includes('href='));
  assert.ok(!html.includes('inline-citation'));
});
