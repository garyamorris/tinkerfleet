/** Lesson 13: a schedule sends a bot a prompt on its own, once per due time, as an ordinary run. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ScriptedModel, assistantMessage } from '@openai/agents/testing';
import { createApp } from '../src/server/app.js';
import { ConversationStore } from '../src/server/conversations.js';
import { ScheduleStore, dueSlot, nextDueAfter, scheduleRefusal } from '../src/server/schedules.js';
import type { Persona } from '../src/shared/types.js';

// Local times, so the lesson reads the same in any time zone. 2026-10-16 is a Friday.
const at = (day: number, hours: number, minutes = 0) =>
  new Date(2026, 9, day, hours, minutes).getTime();
const weekdays = { days: [1, 2, 3, 4, 5], time: '08:00' };

// A. A schedule is days of the week and a time. Friday after 8:00, the next run is Monday's.
assert.equal(nextDueAfter(weekdays, at(16, 9)), at(19, 8));

// B. handledThrough remembers the last due time dealt with. Off from Friday to Wednesday noon,
// three were missed; only the latest is due, so a restart runs it once instead of three times.
const saved = {
  id: 'lesson',
  botId: 'news',
  prompt: 'Summarize this week’s AI news.',
  ...weekdays,
  paused: false,
  createdAt: at(16, 7),
  updatedAt: at(16, 7),
  handledThrough: at(16, 8),
};
assert.equal(dueSlot(saved, at(21, 12)), at(21, 8));

// C. A scheduled run may happen while you are away, so a bot that can edit or run commands
// cannot be given one. Even if it gains them later, those tools still wait for your approval.
const news: Persona = {
  id: 'news',
  role: 'agent',
  name: 'News Watcher',
  purpose: 'Summarize AI news briefly.',
  color: '#567a75',
  shape: 'spark',
  capabilities: ['web', 'memory'],
};
assert.equal(scheduleRefusal(news), undefined);
assert.match(scheduleRefusal({ ...news, capabilities: ['read', 'run'] })!, /Run commands/);

// D. The server runs it. Save the bot and a schedule, then start the app at a time after the
// first due time. A scripted model stands in for the provider, so nothing is sent anywhere.
const folder = mkdtempSync(path.join(tmpdir(), 'tinkerfleet-lesson-13-'));
const statePath = path.join(folder, 'conversations.json');
try {
  new ConversationStore(statePath).save([], [], [news], true);
  new ScheduleStore(`${statePath}.schedules.json`).create(
    { botId: news.id, prompt: saved.prompt, ...weekdays },
    at(16, 9),
  );
  const now = at(19, 8, 5); // Monday, 8:05.
  const start = (model: ScriptedModel) =>
    createApp({
      port: 45999, // Never listened on: the lesson only uses the app's own functions.
      mode: 'live',
      sdkModel: model,
      statePath,
      clock: () => now,
      workspaceToolsEnabled: false,
      webSearchEnabled: false,
    });
  const model = new ScriptedModel([[assistantMessage('Three AI stories this week.')]]);
  let app = start(model); // Startup runs anything that came due while the server was off.
  for (let i = 0; i < 200 && app.state().runs[0]?.status !== 'completed'; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  let state = app.state();
  const [run] = state.runs;
  assert.equal(state.runs.length, 1);
  assert.equal(run.scheduleId, state.schedules[0].id); // The chat marks it as scheduled.
  assert.equal(state.conversations.find((c) => c.id === run.conversationId)!.title, news.name);
  assert.equal(run.messages.at(-1)!.text, 'Three AI stories this week.');
  assert.equal(model.calls.length, 1); // One ordinary run, with the usual budgets.
  assert.equal(state.schedules[0].nextRunAt, at(20, 8));
  await app.close();

  // E. Restart at the same moment: that due time is already handled, so nothing runs again.
  app = start(new ScriptedModel([]));
  await new Promise((resolve) => setTimeout(resolve, 20));
  state = app.state();
  assert.equal(state.runs.length, 1);
  await app.close();
} finally {
  rmSync(folder, { recursive: true, force: true });
}

console.log('13. Schedules: a due time starts one ordinary run in the bot’s own chat.');
console.log('A restart runs a missed time once, and never repeats one already handled.');
console.log('No model was called. Exercise: pause it in B. What does dueSlot return, and why?');
