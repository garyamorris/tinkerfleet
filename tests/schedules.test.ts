import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ScriptedModel, assistantMessage, functionCall } from '@openai/agents/testing';
import type { Model } from '@openai/agents';
import { createApp } from '../src/server/app.js';
import {
  SCHEDULE_LIMITS,
  ScheduleError,
  ScheduleStore,
  dueSlot,
  latestDueAtOrBefore,
  nextDueAfter,
  scheduleRefusal,
} from '../src/server/schedules.js';
import type { Persona, Schedule } from '../src/shared/types.js';

// Local-time dates, so these hold in any time zone. 2026-10-16 is a Friday.
const at = (day: number, hours: number, minutes = 0) =>
  new Date(2026, 9, day, hours, minutes).getTime();
const weekdays = { days: [1, 2, 3, 4, 5], time: '08:00' };
const HOUR = 60 * 60_000;

const bot = (capabilities?: Persona['capabilities']): Record<string, unknown> => ({
  name: 'News Watcher',
  purpose: 'Summarize this week’s AI news.',
  ...(capabilities ? { capabilities } : {}),
});

test('due times follow the chosen days and time in local time', () => {
  assert.equal(new Date(at(16, 0)).getDay(), 5);
  // Friday after 8:00: the next weekday run is Monday at 8:00, not Saturday or Sunday.
  assert.equal(nextDueAfter(weekdays, at(16, 9)), at(19, 8));
  // Exactly at the due time, the next one is the following day's.
  assert.equal(nextDueAfter(weekdays, at(19, 8)), at(20, 8));
  assert.equal(nextDueAfter(weekdays, at(19, 7, 59)), at(19, 8));
  // Sunday evening: the latest due time was Friday's.
  assert.equal(latestDueAtOrBefore(weekdays, at(18, 20)), at(16, 8));
  assert.equal(latestDueAtOrBefore(weekdays, at(19, 8)), at(19, 8));
  const weekly = { days: [0], time: '23:30' };
  assert.equal(nextDueAfter(weekly, at(19, 0)), at(25, 23, 30));
  assert.equal(latestDueAtOrBefore(weekly, at(19, 0)), at(18, 23, 30));
});

test('missed due times collapse into one run, and a handled one never repeats', () => {
  const schedule: Schedule = {
    id: 's',
    botId: 'b',
    prompt: 'Summarize.',
    ...weekdays,
    paused: false,
    createdAt: at(16, 7),
    updatedAt: at(16, 7),
    handledThrough: at(16, 8),
  };
  // Server off from Friday 8:00 to Wednesday noon: Mon, Tue and Wed were all due. Only Wed runs.
  assert.equal(dueSlot(schedule, at(21, 12)), at(21, 8));
  assert.equal(dueSlot({ ...schedule, handledThrough: at(21, 8) }, at(21, 12)), null);
  // Nothing is due before the next time comes round, and a paused schedule is never due.
  assert.equal(dueSlot(schedule, at(18, 12)), null);
  assert.equal(dueSlot({ ...schedule, paused: true }, at(21, 12)), null);
});

test('only bots that cannot edit or run commands can be scheduled', () => {
  const persona = (p: Partial<Persona>) =>
    ({
      id: 'x',
      role: 'agent',
      name: 'X',
      purpose: 'X',
      color: '#567a75',
      shape: 'orbit',
      ...p,
    }) as Persona;
  assert.equal(scheduleRefusal(persona({ capabilities: ['web', 'memory'] })), undefined);
  assert.equal(scheduleRefusal(persona({ capabilities: ['read', 'memory'] })), undefined);
  assert.match(scheduleRefusal(persona({ capabilities: ['web', 'edit'] }))!, /Edit files/);
  assert.match(scheduleRefusal(persona({ capabilities: ['run'] }))!, /Run commands/);
  // Saved before capabilities existed means every tool, so it is refused until you choose.
  assert.match(scheduleRefusal(persona({}))!, /Edit files/);
  assert.match(scheduleRefusal(persona({ role: 'coordinator', capabilities: [] }))!, /ordinary/);
  assert.equal(scheduleRefusal(undefined), 'Bot not found.');
});

test('the store validates input, enforces caps, and survives a restart', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tinkerfleet-schedules-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'conversations.json.schedules.json');
  const store = new ScheduleStore(file);
  const input = { botId: 'news', prompt: '  Summarize this week.  ', ...weekdays };
  const created = store.create(input, at(16, 9));
  assert.equal(created.prompt, 'Summarize this week.');
  assert.equal(created.handledThrough, at(16, 9));
  for (const bad of [
    { ...input, time: '25:00' },
    { ...input, days: [] },
    { ...input, days: [1, 1] },
    { ...input, days: [7] },
    { ...input, prompt: ' ' },
    { ...input, prompt: 'x'.repeat(SCHEDULE_LIMITS.promptChars + 1) },
    { ...input, every: 'minute' },
  ])
    assert.throws(
      () => store.create(bad, at(16, 9)),
      (e) => e instanceof ScheduleError && e.code === 'INVALID',
      JSON.stringify(bad).slice(0, 80),
    );
  store.create(input, at(16, 9));
  store.create(input, at(16, 9));
  assert.throws(
    () => store.create(input, at(16, 9)),
    (e) => e instanceof ScheduleError && e.code === 'CAPACITY' && /up to 3/.test(e.message),
  );
  for (let i = 0; i < SCHEDULE_LIMITS.total - SCHEDULE_LIMITS.perBot; i++)
    store.create({ ...input, botId: `bot-${i}` }, at(16, 9));
  assert.throws(
    () => store.create({ ...input, botId: 'one-more' }, at(16, 9)),
    (e) => e instanceof ScheduleError && e.code === 'CAPACITY' && /up to 10/.test(e.message),
  );
  store.markHandled(created.id, at(19, 8), { at: at(19, 8), runId: 'run-1' });
  // Resuming or changing the time counts from now: it does not run for a time already past.
  store.update(created.id, { paused: true }, at(19, 9));
  assert.equal(store.update(created.id, { paused: false }, at(22, 12)).handledThrough, at(22, 12));
  const reopened = new ScheduleStore(file);
  assert.deepEqual(reopened.list(), store.list());
  assert.deepEqual(reopened.get(created.id)!.lastRun, { at: at(19, 8), runId: 'run-1' });
  assert.ok(reopened.remove(created.id));
  assert.equal(new ScheduleStore(file).list().length, SCHEDULE_LIMITS.total - 1);
  // A damaged file stops startup, unchanged, rather than silently dropping schedules.
  await writeFile(file, '{"version":1,"schedules":"nope"}');
  assert.throws(
    () => new ScheduleStore(file),
    (e) => e instanceof ScheduleError && e.code === 'READ_FAILED',
  );
  assert.equal(await readFile(file, 'utf8'), '{"version":1,"schedules":"nope"}');
});

async function serve(
  t: test.TestContext,
  port: number,
  options: {
    model?: Model;
    mode?: 'demo' | 'live';
    statePath: string;
    clock: () => number;
    workspaceRoot?: string;
  },
) {
  const app = createApp({
    port,
    mode: options.mode ?? 'live',
    sdkModel: options.model,
    statePath: options.statePath,
    clock: options.clock,
    workspaceToolsEnabled: !!options.workspaceRoot,
    ...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {}),
    webSearchEnabled: false,
    demoDelayMs: 1,
  });
  await new Promise<void>((resolve) => app.server.listen(port, '127.0.0.1', resolve));
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await app.close();
  };
  t.after(close);
  const base = `http://127.0.0.1:${port}`;
  const session = await fetch(base + '/api/session', { headers: { Connection: 'close' } });
  const { csrf } = (await session.json()) as { csrf: string };
  const headers = {
    Cookie: session.headers.get('set-cookie')!.split(';')[0],
    Origin: base,
    'X-Tinkerfleet-CSRF': csrf,
    'Content-Type': 'application/json',
    Connection: 'close',
  };
  const send = (url: string, body?: unknown, method = 'POST') =>
    fetch(base + url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const settle = async () => {
    for (let i = 0; i < 400 && app.state().runs.some((r) => r.status === 'running'); i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
  };
  return { app, send, settle, close };
}

async function folder(t: test.TestContext) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'tinkerfleet-schedule-app-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('a due schedule posts one run into the bot’s chat, and restarts never repeat it', async (t) => {
  const directory = await folder(t);
  const statePath = path.join(directory, 'conversations.json');
  let now = at(16, 9);
  const clock = () => now;
  const first = await serve(t, 45401, {
    model: new ScriptedModel([[assistantMessage('This week in AI: three things.')]]),
    statePath,
    clock,
  });
  const scout = (await (
    await first.send('/api/profiles', bot(['web', 'memory']))
  ).json()) as Persona;
  const created = await first.send('/api/schedules', {
    botId: scout.id,
    prompt: 'Summarize this week’s AI news.',
    ...weekdays,
  });
  assert.equal(created.status, 201);
  const schedule = (await created.json()) as { id: string; nextRunAt: number };
  assert.equal(schedule.nextRunAt, at(19, 8));
  // Nothing is due yet: no run.
  first.app.runDueSchedules();
  assert.equal(first.app.state().runs.length, 0);

  now = at(19, 8, 1);
  first.app.runDueSchedules();
  first.app.runDueSchedules(); // The same due time is handled once.
  await first.settle();
  let state = first.app.state();
  assert.equal(state.runs.length, 1);
  const run = state.runs[0];
  const chat = state.conversations.find((c) => c.id === run.conversationId)!;
  assert.equal(chat.participants[0].id, scout.id);
  assert.equal(run.scheduleId, schedule.id);
  assert.equal(run.status, 'completed');
  assert.equal(run.messages[0].author, 'user');
  assert.equal(run.messages[0].text, 'Summarize this week’s AI news.');
  assert.equal(run.messages.at(-1)!.text, 'This week in AI: three things.');
  const view = state.schedules[0];
  assert.deepEqual(view.lastRun, { at: at(19, 8, 1), runId: run.id, conversationId: chat.id });
  assert.equal(view.nextRunAt, at(20, 8));
  await first.close();

  // Off from Monday until Thursday noon: Tue, Wed and Thu were missed. One run, on startup.
  now = at(22, 12);
  const second = await serve(t, 45402, {
    model: new ScriptedModel([[assistantMessage('Catching up.')]]),
    statePath,
    clock,
  });
  await second.settle();
  state = second.app.state();
  assert.equal(state.runs.length, 2);
  assert.equal(state.runs.filter((r) => r.scheduleId === schedule.id).length, 2);
  // It posted into the same chat as before.
  assert.equal(new Set(state.runs.map((r) => r.conversationId)).size, 1);
  assert.equal(state.schedules[0].handledThrough, at(22, 8));
  await second.close();

  // Restarting again at the same time finds nothing new to run. The model has no responses left,
  // so any extra run would fail and show up here.
  const third = await serve(t, 45403, { model: new ScriptedModel([]), statePath, clock });
  await third.settle();
  assert.equal(third.app.state().runs.length, 2);
});

test('a scheduled run never approves anything: an edit waits for you', async (t) => {
  const directory = await folder(t);
  const workspace = path.join(directory, 'workspace');
  await import('node:fs/promises').then((fs) => fs.mkdir(workspace));
  await writeFile(path.join(workspace, 'notes.md'), 'old\n');
  let now = at(16, 9);
  const { app, send, settle } = await serve(t, 45404, {
    model: new ScriptedModel([
      [functionCall('edit_file', { path: 'notes.md', content: 'new\n' }, { callId: 'edit' })],
    ]),
    statePath: path.join(directory, 'conversations.json'),
    clock: () => now,
    workspaceRoot: workspace,
  });
  // A bot that can edit cannot be given a schedule.
  const maker = (await (await send('/api/profiles', bot(['read', 'edit']))).json()) as Persona;
  const refused = await send('/api/schedules', { botId: maker.id, prompt: 'Tidy.', ...weekdays });
  assert.equal(refused.status, 400);
  assert.match(((await refused.json()) as { error: string }).error, /Edit files/);
  // One granted edit after it was scheduled still runs, and the edit still waits.
  const writer = (await (await send('/api/profiles', bot(['read']))).json()) as Persona;
  assert.equal(
    (await send('/api/schedules', { botId: writer.id, prompt: 'Update notes.', ...weekdays }))
      .status,
    201,
  );
  await send(`/api/profiles/${writer.id}`, { capabilities: ['read', 'edit'] });
  now = at(19, 8, 1);
  app.runDueSchedules();
  for (let i = 0; i < 400 && app.state().runs[0]?.status !== 'awaiting_approval'; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  await settle();
  const run = app.state().runs[0];
  assert.equal(run.status, 'awaiting_approval');
  assert.equal(run.approvals.length, 1);
  assert.equal(run.approvals[0].status, 'pending');
  assert.equal(await readFile(path.join(workspace, 'notes.md'), 'utf8'), 'old\n');
  // The next morning the chat is still waiting for you, so that run is skipped, not stacked.
  now = at(20, 8, 1);
  app.runDueSchedules();
  assert.equal(app.state().runs.length, 1);
  assert.match(app.state().schedules[0].lastRun!.skipped!, /still busy/);
  // Pausing and resuming checks the bot again: it now has edit, so it cannot resume.
  const id = app.state().schedules[0].id;
  assert.equal((await send(`/api/schedules/${id}`, { paused: true })).status, 200);
  assert.equal((await send(`/api/schedules/${id}`, { paused: false })).status, 400);
});

test('the HTTP API refuses the primary, enforces caps, and deletes with the bot', async (t) => {
  const directory = await folder(t);
  let now = at(16, 9);
  const { app, send } = await serve(t, 45405, {
    model: new ScriptedModel([]),
    statePath: path.join(directory, 'conversations.json'),
    clock: () => now,
  });
  const primary = (await (
    await send('/api/profiles', { ...bot([]), role: 'coordinator' })
  ).json()) as Persona;
  assert.equal(
    (await send('/api/schedules', { botId: primary.id, prompt: 'Hi.', ...weekdays })).status,
    400,
  );
  assert.equal(
    (await send('/api/schedules', { botId: 'missing', prompt: 'Hi.', ...weekdays })).status,
    404,
  );
  const scout = (await (await send('/api/profiles', bot(['web']))).json()) as Persona;
  for (let i = 0; i < SCHEDULE_LIMITS.perBot; i++)
    assert.equal(
      (await send('/api/schedules', { botId: scout.id, prompt: `Task ${i}.`, ...weekdays })).status,
      201,
    );
  const capped = await send('/api/schedules', {
    botId: scout.id,
    prompt: 'One more.',
    ...weekdays,
  });
  assert.equal(capped.status, 409);
  assert.equal(
    (await send('/api/schedules', { botId: scout.id, prompt: 'x', days: [1], time: '8am' })).status,
    400,
  );
  const [first] = app.state().schedules;
  const edited = await send(`/api/schedules/${first.id}`, { time: '17:30', days: [0, 6] });
  assert.equal(edited.status, 200);
  assert.equal(((await edited.json()) as { nextRunAt: number }).nextRunAt, at(17, 17, 30));
  assert.equal((await send(`/api/schedules/${first.id}`, undefined, 'DELETE')).status, 200);
  assert.equal((await send(`/api/schedules/${first.id}`, undefined, 'DELETE')).status, 404);
  assert.equal(app.state().schedules.length, SCHEDULE_LIMITS.perBot - 1);
  await send(`/api/profiles/${scout.id}`, undefined, 'DELETE');
  assert.equal(app.state().schedules.length, 0);
});

test('one schedule never starts twice within an hour', async (t) => {
  const directory = await folder(t);
  let now = at(19, 7, 50);
  const { app, send, settle } = await serve(t, 45406, {
    model: new ScriptedModel([[assistantMessage('Done.')]]),
    statePath: path.join(directory, 'conversations.json'),
    clock: () => now,
  });
  const scout = (await (await send('/api/profiles', bot(['memory']))).json()) as Persona;
  await send('/api/schedules', { botId: scout.id, prompt: 'Check in.', ...weekdays });
  now = at(19, 8);
  app.runDueSchedules();
  await settle();
  assert.equal(app.state().runs.length, 1);
  // Moving the time to 8:30 the same morning would run again within the hour: it is skipped.
  const id = app.state().schedules[0].id;
  await send(`/api/schedules/${id}`, { time: '08:30' });
  now = at(19, 8, 30);
  app.runDueSchedules();
  assert.equal(app.state().runs.length, 1);
  assert.match(app.state().schedules[0].lastRun!.skipped!, /less than an hour/);
  assert.equal(app.state().schedules[0].nextRunAt, at(20, 8, 30));
});

test('demo mode shows schedules but never fires them', async (t) => {
  const directory = await folder(t);
  let now = at(16, 9);
  const { app, send } = await serve(t, 45407, {
    mode: 'demo',
    statePath: path.join(directory, 'conversations.json'),
    clock: () => now,
  });
  const scout = (await (await send('/api/profiles', bot(['memory']))).json()) as Persona;
  assert.equal(
    (await send('/api/schedules', { botId: scout.id, prompt: 'Hi.', ...weekdays })).status,
    201,
  );
  now = at(19, 8, 1);
  app.runDueSchedules();
  const state = app.state();
  assert.equal(state.schedulesRun, false);
  assert.equal(state.runs.length, 0);
  assert.equal(state.schedules[0].lastRun, undefined);
  assert.equal(state.schedules[0].nextRunAt, at(19, 8));
});

test('live mode without a model skips the schedule and sends nothing', async (t) => {
  const directory = await folder(t);
  let now = at(16, 9);
  const previous = { model: process.env.TINKERFLEET_MODEL, key: process.env.OPENAI_API_KEY };
  delete process.env.TINKERFLEET_MODEL;
  delete process.env.OPENAI_API_KEY;
  t.after(() => {
    if (previous.model !== undefined) process.env.TINKERFLEET_MODEL = previous.model;
    if (previous.key !== undefined) process.env.OPENAI_API_KEY = previous.key;
  });
  const { app, send } = await serve(t, 45408, {
    statePath: path.join(directory, 'conversations.json'),
    clock: () => now,
  });
  const scout = (await (await send('/api/profiles', bot(['memory']))).json()) as Persona;
  await send('/api/schedules', { botId: scout.id, prompt: 'Hi.', ...weekdays });
  now = at(19, 8, 1);
  app.runDueSchedules();
  assert.equal(app.state().runs.length, 0);
  assert.match(app.state().schedules[0].lastRun!.skipped!, /model and a server-side API key/);
  // It counts as handled: it is not retried every half minute.
  assert.equal(app.state().schedules[0].handledThrough, at(19, 8));
  assert.equal(HOUR, SCHEDULE_LIMITS.minGapMs);
});
