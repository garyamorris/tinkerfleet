import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageText, MessageSources, type CitationSource } from '../src/client/citations';
const render = (text: string, sources: CitationSource[]) =>
  renderToStaticMarkup(
    React.createElement(
      'div',
      null,
      React.createElement(MessageText, { text, sources }),
      React.createElement(MessageSources, { sources }),
    ),
  );
test('offline fixture places clickable citation beside its supported claim', () => {
  const html = render('First claim. Second claim.', [
    { url: 'https://example.com/one', title: 'Fixture source', startIndex: 0, endIndex: 12 },
  ]);
  assert.match(html, /First claim\.<a [^>]*class="inline-citation"/);
  assert.match(html, />\[1\]<\/a> Second claim\./);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /Sources for this reply/);
});
test('source text and titles are escaped and non-web URLs never become links', () => {
  const html = render('<img src=x onerror=alert(1)>', [
    { url: 'javascript:alert(1)', title: 'Bad', startIndex: 0, endIndex: 1 },
    { url: 'data:text/html,bad', title: 'Bad' },
    { url: 'https://example.com/', title: '<script>bad</script>', startIndex: 0, endIndex: 1 },
  ]);
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes('href="data:'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img '));
  assert.ok(html.includes('&lt;'));
});
test('invalid offsets preserve text and provide only a source-list fallback', () => {
  const html = render('Safe text.', [
    { url: 'https://example.com/', title: 'Fixture', startIndex: -1, endIndex: 9 },
    { url: 'https://example.com/two', title: 'Two', startIndex: 0, endIndex: 999 },
    { url: 'https://example.com/three', title: 'Three', startIndex: 0, endIndex: 2.5 },
  ]);
  assert.ok(!html.includes('class="inline-citation"'));
  assert.ok(html.includes('Safe text.'));
  assert.ok(html.includes('href="https://example.com/"'));
});
test('repeated sources retain stable numbering and citations without duplicating footer links', () => {
  const html = render('A. B.', [
    { url: 'https://example.com/', title: 'Same', startIndex: 0, endIndex: 2 },
    { url: 'https://example.com/', title: 'Same', startIndex: 3, endIndex: 5 },
    { url: 'https://example.com/', title: 'Same', startIndex: 3, endIndex: 5 },
  ]);
  assert.equal((html.match(/class="inline-citation"/g) ?? []).length, 2);
  assert.equal((html.match(/href="https:\/\/example.com\/"/g) ?? []).length, 3);
  assert.ok(!html.includes('[2]'));
});
test('annotation boundaries never split an emoji surrogate pair', () => {
  const html = render('🌱 grows.', [
    { url: 'https://example.com/', title: 'Fixture', startIndex: 0, endIndex: 1 },
  ]);
  assert.ok(!html.includes('class="inline-citation"'));
  assert.ok(html.includes('🌱 grows.'));
});

test('only obvious covered provider markers are replaced by clickable numbers', () => {
  const text = 'A fact. citefixture0 Uncovered citefixture1';
  const end = text.indexOf(' Uncovered');
  const html = render(text, [
    { url: 'https://example.com/', title: 'Fixture', startIndex: 0, endIndex: end },
  ]);
  assert.ok(html.includes('A fact. '));
  assert.ok(!html.includes('citefixture0'));
  assert.ok(html.includes('citefixture1'));
  assert.ok(html.includes('[1]'));
});
