/**
 * When a schedule is due, and which bots may have one. Pure functions, shared by the server's
 * scheduler (src/server/schedules.ts) and the Bot library, so both show the same next run time.
 */
import type { Capability, Persona, Schedule, ScheduleView } from './types.js';

export const SCHEDULE_LIMITS = Object.freeze({
  perBot: 3,
  total: 10,
  promptChars: 2_000,
  /** Even if the clock or the schedule changes, one schedule never starts twice within this. */
  minGapMs: 60 * 60_000,
  /** How often the server looks for due schedules. */
  checkMs: 30_000,
  bytes: 256 * 1024,
});

/** When a schedule runs: these days of the week (0 is Sunday) at this 'HH:MM'. */
export interface ScheduleSpec {
  days: number[];
  time: string;
}

/** The moment `time` falls on the calendar day `offset` days from `from`, in local time. */
function slotOn(from: number, offset: number, time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const day = new Date(from);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset, hours, minutes);
}

/** The first due time strictly after `after`. */
export function nextDueAfter(spec: ScheduleSpec, after: number): number | null {
  for (let offset = 0; offset <= 7; offset++) {
    const slot = slotOn(after, offset, spec.time);
    if (spec.days.includes(slot.getDay()) && slot.getTime() > after) return slot.getTime();
  }
  return null;
}

/** The latest due time at or before `at`. */
export function latestDueAtOrBefore(spec: ScheduleSpec, at: number): number | null {
  for (let offset = 0; offset >= -7; offset--) {
    const slot = slotOn(at, offset, spec.time);
    if (spec.days.includes(slot.getDay()) && slot.getTime() <= at) return slot.getTime();
  }
  return null;
}

/** The due time this schedule should run for now, or null when nothing is waiting. */
export function dueSlot(schedule: Schedule, now: number): number | null {
  if (schedule.paused) return null;
  const slot = latestDueAtOrBefore(schedule, now);
  return slot !== null && slot > schedule.handledThrough ? slot : null;
}

export function scheduleView(schedule: Schedule, now: number): ScheduleView {
  return {
    ...schedule,
    days: [...schedule.days],
    ...(schedule.lastRun ? { lastRun: { ...schedule.lastRun } } : {}),
    nextRunAt: schedule.paused
      ? null
      : (dueSlot(schedule, now) ?? nextDueAfter(schedule, Math.max(now, schedule.handledThrough))),
  };
}

/** Capabilities that pause for your approval. A schedule runs while you may be away. */
const ATTENDED: readonly Capability[] = ['edit', 'run'];

/**
 * Why this bot cannot be given a schedule, or undefined when it can. A profile saved before
 * capabilities existed has every tool, so it is refused until you choose its capabilities.
 */
export function scheduleRefusal(bot: Persona | undefined): string | undefined {
  if (!bot) return 'Bot not found.';
  if (bot.role === 'coordinator')
    return 'Schedules are for ordinary bots. The primary can create bots and start other runs, so it is not run unattended.';
  if ((bot.capabilities ?? ATTENDED).some((c) => ATTENDED.includes(c)))
    return 'A scheduled bot runs while you may be away, so it cannot have Edit files or Run commands. Remove them from its capabilities first.';
  return undefined;
}
