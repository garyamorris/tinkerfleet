import React from 'react';
import type { Run } from '../shared/types';
import { Icon } from './ui';
const rawToolNames = new Set([
  'list_files',
  'read_file',
  'run_command',
  'edit_file',
  'web_search',
  'web_open_page',
  'web_find_in_page',
  'start_group_conversation',
  'create_agent',
  'message_agent',
  'recall_memory',
  'remember_memory',
  'forget_memory',
]);
export function usefulDetail(kind: string, detail?: string) {
  return detail &&
    !(
      kind === 'tool' &&
      (rawToolNames.has(detail.trim()) || /^ask_[A-Za-z0-9_-]+$/.test(detail.trim()))
    )
    ? detail
    : null;
}
export function RunActivity({ run, nameFor }: { run: Run; nameFor: (id: string) => string }) {
  const events = run.events.filter(
    (e) => e.kind === 'tool' || e.kind === 'delegation' || e.kind === 'error',
  );
  const last = events.at(-1),
    working = run.status === 'running';
  if (!working && !events.length) return null;
  const summary = working
    ? (last?.title ?? `${nameFor(run.activeAgent ?? 'coordinator')} is working…`)
    : `${events.length} activity ${events.length === 1 ? 'step' : 'steps'}`;
  return (
    <details className="run-activity">
      <summary>
        <span className={working ? 'working-dot' : 'activity-dot'} />
        <span role="status">{summary}</span>
        <Icon name="chevron" size={13} />
      </summary>
      <ol>
        {events.length ? (
          events.slice(-12).map((event) => (
            <li key={event.id}>
              <strong>{event.title}</strong>
              <span>
                {nameFor(event.agent)} · +
                {Math.max(0, (event.at - run.startedAt) / 1000).toFixed(1)}s
              </span>
              {usefulDetail(event.kind, event.detail) && <p>{event.detail}</p>}
            </li>
          ))
        ) : (
          <li>Waiting for the next activity update.</li>
        )}
      </ol>
    </details>
  );
}
