/**
 * Scheduled runs: a saved prompt the server sends to one bot on its own.
 *
 * A schedule names days of the week and one time of day, in the server's local time. It is due at
 * each such moment. The server checks every half minute; a due schedule starts an ordinary run in
 * the bot's own chat, through the same path as a message you type (app.ts).
 *
 * `handledThrough` is what makes restarts safe. Due times at or before it never run, and it moves
 * forward to each due time as soon as that time is handled. So when the server was off through
 * several due times, only the latest one runs, once, on startup. Nothing piles up.
 */
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { redactSdkText } from './safety.js';
import type { Schedule } from '../shared/types.js';
import { SCHEDULE_LIMITS } from '../shared/schedules.js';

export {
  SCHEDULE_LIMITS,
  dueSlot,
  latestDueAtOrBefore,
  nextDueAfter,
  scheduleRefusal,
  scheduleView,
  type ScheduleSpec,
} from '../shared/schedules.js';

export class ScheduleError extends Error {
  constructor(
    public readonly code: 'INVALID' | 'CAPACITY' | 'NOT_FOUND' | 'READ_FAILED' | 'WRITE_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'ScheduleError';
  }
}

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a time as HH:MM.');
const days = z
  .array(z.number().int().min(0).max(6))
  .min(1, 'Choose at least one day.')
  .max(7)
  .refine((list) => new Set(list).size === list.length, 'Choose each day once.')
  .transform((list) => [...list].sort((a, b) => a - b));
const prompt = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, '\n').trim())
  .refine(
    (value) =>
      value.length > 0 &&
      value.length <= SCHEDULE_LIMITS.promptChars &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
    `Enter a prompt of 1–${SCHEDULE_LIMITS.promptChars.toLocaleString('en-US')} characters.`,
  )
  .transform(redactSdkText);
const scheduleSchema = z
  .object({
    id: identifier,
    botId: identifier,
    prompt,
    days,
    time: clockTime,
    paused: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
    handledThrough: timestamp,
    lastRun: z
      .object({
        at: timestamp,
        runId: identifier.optional(),
        conversationId: identifier.optional(),
        skipped: z.string().max(500).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const envelopeSchema = z
  .object({
    version: z.literal(1),
    schedules: z.array(scheduleSchema).max(SCHEDULE_LIMITS.total),
  })
  .strict();
const createSchema = z
  .object({ botId: identifier, prompt, days, time: clockTime, paused: z.boolean().optional() })
  .strict();
const updateSchema = z
  .object({
    prompt: prompt.optional(),
    days: days.optional(),
    time: clockTime.optional(),
    paused: z.boolean().optional(),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  // Our own messages explain the fix. Zod's generic ones (unknown key, wrong type) do not.
  const own = issue && issue.code === 'custom' ? issue.message : undefined;
  throw new ScheduleError(
    'INVALID',
    own ??
      (issue?.path[0] === 'time'
        ? 'Choose a time as HH:MM.'
        : issue?.path[0] === 'days'
          ? 'Choose days of the week from 0 (Sunday) to 6 (Saturday).'
          : 'Only a bot, prompt, days, time and paused are accepted.'),
  );
}

function regularPrivateTarget(file: string) {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1))
    throw new Error('Invalid schedule target.');
}
function directoryCheck(directory: string) {
  const stat = lstatSync(directory, { throwIfNoEntry: false });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
    throw new Error('Invalid schedule directory.');
}
function validate(input: unknown): Schedule[] {
  const list = parse(envelopeSchema, input).schedules as Schedule[];
  const ids = new Set(list.map((s) => s.id));
  const perBot = new Map<string, number>();
  for (const s of list) perBot.set(s.botId, (perBot.get(s.botId) ?? 0) + 1);
  if (ids.size !== list.length || [...perBot.values()].some((n) => n > SCHEDULE_LIMITS.perBot))
    throw new ScheduleError('INVALID', 'Saved schedules have duplicate entries or exceed a limit.');
  return list;
}

/** Schedules saved in their own private file, replaced atomically on each change. */
export class ScheduleStore {
  private schedules: Schedule[] = [];
  constructor(private readonly statePath?: string) {
    if (!statePath) return;
    try {
      directoryCheck(path.dirname(statePath));
      regularPrivateTarget(statePath);
      if (!lstatSync(statePath, { throwIfNoEntry: false })) return;
      const fd = openSync(
        statePath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > SCHEDULE_LIMITS.bytes)
          throw new Error('Invalid schedule file.');
        this.schedules = validate(JSON.parse(readFileSync(fd, 'utf8')));
      } finally {
        closeSync(fd);
      }
    } catch {
      throw new ScheduleError(
        'READ_FAILED',
        'Saved schedules could not be read safely. The saved file was left unchanged; restore or repair it before starting.',
      );
    }
  }
  list(): Schedule[] {
    return this.schedules.map((s) => ({
      ...s,
      days: [...s.days],
      ...(s.lastRun ? { lastRun: { ...s.lastRun } } : {}),
    }));
  }
  get(id: string): Schedule | undefined {
    return this.list().find((s) => s.id === id);
  }
  /** Validates the input; the caller has already checked that the bot may be scheduled. */
  create(input: unknown, now: number): Schedule {
    const body = parse(createSchema, input);
    if (this.schedules.length >= SCHEDULE_LIMITS.total)
      throw new ScheduleError(
        'CAPACITY',
        `You can keep up to ${SCHEDULE_LIMITS.total} schedules. Delete one before adding another.`,
      );
    if (this.schedules.filter((s) => s.botId === body.botId).length >= SCHEDULE_LIMITS.perBot)
      throw new ScheduleError(
        'CAPACITY',
        `A bot can have up to ${SCHEDULE_LIMITS.perBot} schedules. Delete one before adding another.`,
      );
    const schedule: Schedule = {
      id: randomUUID(),
      botId: body.botId,
      prompt: body.prompt,
      days: body.days,
      time: body.time,
      paused: body.paused ?? false,
      createdAt: now,
      updatedAt: now,
      // A new schedule waits for its next due time; it never runs for one already past.
      handledThrough: now,
    };
    this.commit([...this.schedules, schedule]);
    return { ...schedule };
  }
  update(id: string, input: unknown, now: number): Schedule {
    const old = this.schedules.find((s) => s.id === id);
    if (!old) throw new ScheduleError('NOT_FOUND', 'Schedule not found.');
    const body = parse(updateSchema, input);
    const next: Schedule = { ...old, ...body, updatedAt: now };
    // A changed time or a resume counts from now, so it never runs for a time that already passed.
    if (body.time !== undefined || body.days !== undefined || (old.paused && body.paused === false))
      next.handledThrough = Math.max(old.handledThrough, now);
    this.commit(this.schedules.map((s) => (s.id === id ? next : s)));
    return { ...next };
  }
  remove(id: string): boolean {
    const next = this.schedules.filter((s) => s.id !== id);
    if (next.length === this.schedules.length) return false;
    this.commit(next);
    return true;
  }
  removeForBot(botId: string): void {
    const next = this.schedules.filter((s) => s.botId !== botId);
    if (next.length !== this.schedules.length) this.commit(next);
  }
  /** Record that a due time was handled, before the run starts, so a crash cannot repeat it. */
  markHandled(id: string, slot: number, lastRun?: Schedule['lastRun']): void {
    this.commit(
      this.schedules.map((s) =>
        s.id === id
          ? {
              ...s,
              handledThrough: Math.max(s.handledThrough, slot),
              ...(lastRun ? { lastRun: { ...lastRun } } : {}),
            }
          : s,
      ),
    );
  }
  private commit(next: Schedule[]): void {
    const validated = validate({ version: 1, schedules: next }),
      serialized = JSON.stringify({ version: 1, schedules: validated });
    if (Buffer.byteLength(serialized) > SCHEDULE_LIMITS.bytes)
      throw new ScheduleError('CAPACITY', 'The schedule store is full. Delete a schedule first.');
    if (this.statePath) {
      const directory = path.dirname(this.statePath),
        temporary = path.join(directory, `.schedules-${randomUUID()}.tmp`);
      let fd: number | undefined;
      try {
        directoryCheck(directory);
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        directoryCheck(directory);
        regularPrivateTarget(this.statePath);
        fd = openSync(
          temporary,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        writeFileSync(fd, serialized);
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        regularPrivateTarget(this.statePath);
        renameSync(temporary, this.statePath);
      } catch {
        throw new ScheduleError(
          'WRITE_FAILED',
          'Schedules could not be saved. Existing schedules were left unchanged. Check local storage before trying again.',
        );
      } finally {
        if (fd !== undefined)
          try {
            closeSync(fd);
          } catch {}
        try {
          unlinkSync(temporary);
        } catch {}
      }
    }
    this.schedules = validated;
  }
}
