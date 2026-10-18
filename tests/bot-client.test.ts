import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { directBotChat } from '../src/client/bot-chat';
import { MemoryPanel } from '../src/client/memory-panel';
import type { Persona, Conversation } from '../src/shared/types';
const bot: Persona = {
  id: 'ada',
  name: 'Ada',
  purpose: 'Patient tutor',
  role: 'agent',
  color: '#3978b8',
  shape: 'orbit',
};
const chat = (id: string, updatedAt: number, participants = [bot]) =>
  ({
    id,
    updatedAt,
    createdAt: 1,
    title: id,
    participants,
    draft: 'Keep this draft',
    currentRunId: null,
  }) as Conversation;
test('opening a bot reuses its most recent direct chat without creating or changing drafts', async () => {
  const chats = [
    chat('older', 10),
    chat('newer', 20),
    chat('group', 30, [bot, { ...bot, id: 'other' }]),
  ];
  let calls = 0;
  const result = await directBotChat(bot, chats, [bot], async () => {
    calls++;
    throw new Error('Should reuse');
  });
  assert.equal(result.id, 'newer');
  assert.equal(result.draft, 'Keep this draft');
  assert.equal(calls, 0);
});
test('a new bot gets a direct chat with its own name and single participant', async () => {
  let body: unknown;
  const created = chat('created', 1);
  const result = await directBotChat(bot, [], [bot], async (request) => {
    body = request;
    return created;
  });
  assert.equal(result.id, 'created');
  assert.deepEqual(body, { title: 'Ada', participants: [bot] });
});
test('primary direct chat includes ordinary agents in its roster', async () => {
  const primary = { ...bot, id: 'orbit', role: 'coordinator' as const };
  let body: unknown;
  await directBotChat(primary, [], [primary, bot], async (request) => {
    body = request;
    return chat('primary', 1, [primary]);
  });
  assert.deepEqual(body, { title: 'Ada', participants: [primary], availableBots: [bot] });
});
test('memory panel displays escaped per-bot notes and labelled delete/add controls', () => {
  const html = renderToStaticMarkup(
    React.createElement(MemoryPanel, {
      name: 'Ada',
      entries: [
        { id: 'm', agentId: 'ada', text: '<script>not HTML</script>', createdAt: 1, updatedAt: 1 },
      ],
      onAdd: async () => {},
      onDelete: async () => {},
    }),
  );
  assert.ok(html.includes('Ada’s own memory'));
  assert.ok(html.includes('saved on this Mac'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('Delete memory:'));
  assert.ok(html.includes('Save memory'));
  assert.ok(html.includes('maxLength="2000"'));
});
