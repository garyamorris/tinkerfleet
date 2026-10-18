/** One bot's schedules: prompts the server sends it on its own, and what happened last time. */
import React, { useState } from 'react';
import type { Persona, Run, ScheduleView } from '../shared/types';
import { SCHEDULE_LIMITS, scheduleRefusal } from '../shared/schedules';
import { statusText } from './ui';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS = [1, 2, 3, 4, 5];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export interface ScheduleDraft {
  prompt: string;
  days: number[];
  time: string;
}

export function daysLabel(days: number[]): string {
  if (days.length === 7) return 'Every day';
  if (days.join() === WEEKDAYS.join()) return 'Weekdays';
  if (days.join() === '0,6') return 'Weekends';
  return days.map((d) => DAY_NAMES[d]).join(', ');
}

const when = (at: number) =>
  new Date(at).toLocaleString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export function ScheduleDialogBody({
  bot,
  schedules,
  runs,
  schedulesRun,
  timeZone,
  onSave,
  onPause,
  onDelete,
  onOpenChat,
}: {
  bot: Persona;
  schedules: ScheduleView[];
  runs: Run[];
  schedulesRun: boolean;
  timeZone: string;
  onSave: (draft: ScheduleDraft, id?: string) => Promise<void>;
  onPause: (schedule: ScheduleView, paused: boolean) => Promise<void>;
  onDelete: (schedule: ScheduleView) => Promise<void>;
  onOpenChat: (conversationId: string) => void;
}) {
  const empty: ScheduleDraft = { prompt: '', days: WEEKDAYS, time: '08:00' };
  const [draft, setDraft] = useState<ScheduleDraft>(empty),
    [editing, setEditing] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const refusal = scheduleRefusal(bot);
  const full = schedules.length >= SCHEDULE_LIMITS.perBot;
  async function act(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const toggleDay = (day: number) =>
    setDraft({
      ...draft,
      days: draft.days.includes(day)
        ? draft.days.filter((d) => d !== day)
        : [...draft.days, day].sort((a, b) => a - b),
    });
  const showForm = editing !== null || (!refusal && !full);
  return (
    <>
      <p className="modal-intro">
        {bot.name} gets this prompt on its own at the time you choose, and replies in its chat. Each
        run is a real model request, paid like one you send, within the usual run budgets. Times use
        this server’s clock ({timeZone}).
      </p>
      {!schedulesRun && (
        <p className="panel-note" role="note">
          Demo mode saves schedules but does not run them. Start Tinkerfleet in live mode to run
          them.
        </p>
      )}
      {refusal && (
        <p className="capability-warning" role="note">
          {refusal}
        </p>
      )}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <ul className="schedule-list">
        {schedules.map((s) => {
          const last = s.lastRun,
            run = last?.runId ? runs.find((r) => r.id === last.runId) : undefined;
          return (
            <li key={s.id} className={s.paused ? 'paused' : ''}>
              <div className="schedule-when">
                <strong>
                  {daysLabel(s.days)} at {s.time}
                </strong>
                <span>
                  {s.paused
                    ? 'Paused'
                    : s.nextRunAt
                      ? `Next: ${when(s.nextRunAt)}${schedulesRun ? '' : ' (live mode only)'}`
                      : 'Not scheduled'}
                </span>
              </div>
              <p>{s.prompt}</p>
              {last && (
                <p className="schedule-last">
                  Last: {when(last.at)} ·{' '}
                  {last.skipped ?? (run ? statusText[run.status] : 'Run started')}
                  {last.conversationId && (
                    <button
                      className="text-button"
                      onClick={() => onOpenChat(last.conversationId!)}
                    >
                      Open chat
                    </button>
                  )}
                </p>
              )}
              {refusal && !s.paused && (
                <p className="capability-warning">
                  Its scheduled runs will stop at each edit or command and wait for your approval.
                  Once paused, it cannot resume until those capabilities are removed.
                </p>
              )}
              <div className="schedule-actions">
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setEditing(s.id);
                    setDraft({ prompt: s.prompt, days: s.days, time: s.time });
                  }}
                >
                  Edit
                </button>
                <button
                  className="text-button"
                  disabled={busy || (s.paused && !!refusal)}
                  onClick={() => act(() => onPause(s, !s.paused))}
                >
                  {s.paused ? 'Resume' : 'Pause'}
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  aria-label={`Delete schedule: ${daysLabel(s.days)} at ${s.time}`}
                  onClick={() =>
                    act(async () => {
                      await onDelete(s);
                      if (editing === s.id) {
                        setEditing(null);
                        setDraft(empty);
                      }
                    })
                  }
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {!schedules.length && (
        <p className="memory-empty">
          No schedules yet. For example: every weekday at 08:00, “Summarize this week’s AI news.”
        </p>
      )}
      {showForm && (
        <form
          className="schedule-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await onSave(draft, editing ?? undefined);
              setEditing(null);
              setDraft(empty);
            });
          }}
        >
          <label className="field-label">
            {editing ? 'Edit the prompt' : 'Add a schedule'}
            <textarea
              rows={3}
              required
              maxLength={SCHEDULE_LIMITS.promptChars}
              value={draft.prompt}
              placeholder="For example, Summarize this week’s most important AI news with sources."
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
            />
          </label>
          <fieldset className="schedule-days">
            <legend>Days</legend>
            {DAY_NAMES.map((name, day) => (
              <label key={name}>
                <input
                  type="checkbox"
                  checked={draft.days.includes(day)}
                  onChange={() => toggleDay(day)}
                />
                {name}
              </label>
            ))}
            <button
              type="button"
              className="text-button"
              onClick={() => setDraft({ ...draft, days: WEEKDAYS })}
            >
              Weekdays
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setDraft({ ...draft, days: ALL_DAYS })}
            >
              Every day
            </button>
          </fieldset>
          <label className="field-label schedule-time">
            Time
            <input
              type="time"
              required
              value={draft.time}
              onChange={(e) => setDraft({ ...draft, time: e.target.value })}
            />
          </label>
          <span className="field-hint">
            Runs at most once a day, never twice within an hour. {schedules.length}/
            {SCHEDULE_LIMITS.perBot} for this bot, up to {SCHEDULE_LIMITS.total} in all. A run due
            while the server is off runs once when it starts again.
          </span>
          <div className="actions">
            {editing && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setEditing(null);
                  setDraft(empty);
                }}
              >
                Cancel
              </button>
            )}
            <button
              className="primary"
              disabled={busy || !draft.prompt.trim() || !draft.days.length || !draft.time}
            >
              {busy ? 'Saving…' : editing ? 'Save schedule' : 'Add schedule'}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
