/** Inspect one task: its activity timeline, command output, approved changes, and token usage. */
import React from 'react';
import type { AgentId, AppState, Persona, Run } from '../shared/types';
import { character } from './profiles';
import { usefulDetail } from './run-activity';
import { TraceView } from './trace-view';
import { Avatar, Diff, Icon, Modal, statusText } from './ui';

const tabs = ['Activity', 'Trace', 'Output', 'Changes'];

/** Long event details (such as the run's budget note) show their first sentence until opened. */
function EventDetail({ text }: { text?: string }) {
  if (!text) return null;
  const first = /^[\s\S]{40,200}?[.!?](?=\s)/.exec(text)?.[0];
  if (!first || text.length < 220) return <p>{text}</p>;
  return (
    <details className="event-detail">
      <summary>
        {first} <span>More</span>
      </summary>
      <p>{text.slice(first.length).trim()}</p>
    </details>
  );
}

export function TaskDetailsDialog({
  state,
  run,
  runs,
  team,
  person,
  tab,
  onTab,
  onSelectRun,
  onClose,
}: {
  state: AppState | null;
  run?: Run;
  runs: Run[];
  team: Persona[];
  person: (id: AgentId) => Persona;
  tab: string;
  onTab: (tab: string) => void;
  onSelectRun: (runId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Task details" onClose={() => onClose()}>
      <label className="field-label">
        Task in this conversation
        <select value={run?.id ?? ''} onChange={(e) => onSelectRun(e.target.value)}>
          {runs.map((r) => (
            <option value={r.id} key={r.id}>
              {r.prompt.slice(0, 80)} · {statusText[r.status]}
            </option>
          ))}
        </select>
      </label>
      <p className="modal-intro">
        {run
          ? `${run.mode === 'demo' ? 'Scripted demo' : 'Live run'} · ${statusText[run.status]}`
          : 'Activity, output, and changes appear when the conversation starts.'}
      </p>
      {state?.mode === 'live' && (
        <div className="local-workspace">
          <span>Selected local folder</span>
          <code>{state.workspaceRoot}</code>
          <p>
            {state.workspaceToolsEnabled
              ? 'Approved edits change real files. Commands run with your user permissions; this folder is not a sandbox.'
              : 'File tools are off. No file access or commands; live chat remains available.'}
          </p>
        </div>
      )}
      {run?.usage && (
        <dl className="run-usage" aria-label="Reported usage for this run">
          <div>
            <dt>Model calls</dt>
            <dd>{run.usage.modelCalls.toLocaleString()}</dd>
          </div>
          {/* The scripted demo model counts no tokens; three zeros would only be noise. */}
          {run.usage.totalTokens > 0 || run.mode === 'live' ? (
            <>
              <div>
                <dt>Input tokens</dt>
                <dd>{run.usage.inputTokens.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Output tokens</dt>
                <dd>{run.usage.outputTokens.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Total tokens</dt>
                <dd>{run.usage.totalTokens.toLocaleString()}</dd>
              </div>
            </>
          ) : (
            <div className="run-usage-note">The scripted demo model reports no tokens.</div>
          )}
        </dl>
      )}
      {run && (
        <div className="snapshot-team" aria-label="Team for this task">
          {team.map((p) => (
            <span key={p.id} title={p.purpose}>
              <Avatar person={character(p)} size={24} />
              {p.name}
            </span>
          ))}
        </div>
      )}
      <div className="inspector-tabs" role="tablist" aria-label="Run inspector">
        {tabs.map((t) => (
          <button
            key={t}
            id={`tab-${t}`}
            role="tab"
            aria-controls="detail-panel"
            aria-selected={tab === t}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => onTab(t)}
            onKeyDown={(e) => {
              const i = tabs.indexOf(t),
                next =
                  e.key === 'ArrowRight'
                    ? tabs[(i + 1) % tabs.length]
                    : e.key === 'ArrowLeft'
                      ? tabs[(i + tabs.length - 1) % tabs.length]
                      : e.key === 'Home'
                        ? tabs[0]
                        : e.key === 'End'
                          ? tabs[tabs.length - 1]
                          : null;
              if (next) {
                e.preventDefault();
                onTab(next);
                document.getElementById(`tab-${next}`)?.focus();
              }
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div
        className="detail-panel"
        id="detail-panel"
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
      >
        {tab === 'Activity' ? (
          run?.events.length ? (
            <ol className="timeline">
              {run.events.map((e) => (
                <li key={e.id}>
                  <Icon
                    name={
                      e.kind === 'approval' ? 'shield' : e.kind === 'tool' ? 'terminal' : 'activity'
                    }
                    size={16}
                  />
                  <div>
                    <strong>{e.title}</strong>
                    <EventDetail text={usefulDetail(e.kind, e.detail) ?? undefined} />
                    <small>
                      {person(e.agent).name} · +{((e.at - run.startedAt) / 1000).toFixed(1)}s
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty-state">
              Every step, in plain sight. Start a task to see the activity.
            </p>
          )
        ) : tab === 'Trace' ? (
          run ? (
            <TraceView
              key={run.id}
              run={run}
              nameFor={(id) => person(id).name}
              others={(state?.runs ?? [])
                .filter(
                  (r) => r.id !== run.id && r.conversationId && (r.usage?.modelCalls ?? 0) > 0,
                )
                .sort((a, b) => b.startedAt - a.startedAt)
                .slice(0, 25)
                .map((r) => ({
                  run: r,
                  label: `${r.prompt.slice(0, 60)} · ${state?.conversations.find((c) => c.id === r.conversationId)?.title ?? 'chat'} · ${statusText[r.status]}`,
                }))}
            />
          ) : (
            <p className="empty-state">
              Start a task to see what each model call sent and got back.
            </p>
          )
        ) : tab === 'Output' ? (
          run?.output ? (
            <>
              <p className="output-label">Command output</p>
              <pre className="terminal-output">{run.output}</pre>
            </>
          ) : (
            <p className="empty-state">Command output appears after you approve a command.</p>
          )
        ) : run?.artifacts.length ? (
          run.artifacts.map((a) => (
            <div className="artifact" key={a.path}>
              <div className="diff-file">
                <Icon name="file" size={15} />
                {a.path}
              </div>
              <Diff before={a.before} after={a.after} />
              <div className="artifact-footer">
                <span>
                  {a.simulated
                    ? 'Demo artifact · no file was written'
                    : 'Approved edit · recorded changes'}
                </span>
                <button
                  className="secondary"
                  onClick={() => {
                    const url = URL.createObjectURL(new Blob([a.after], { type: 'text/plain' }));
                    const el = document.createElement('a');
                    el.href = url;
                    el.download = a.path.split('/').pop() ?? 'artifact.txt';
                    document.body.appendChild(el);
                    el.click();
                    el.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 60000);
                  }}
                >
                  Download
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="empty-state">Approved edits appear here as reviewable changes.</p>
        )}
      </div>
    </Modal>
  );
}
