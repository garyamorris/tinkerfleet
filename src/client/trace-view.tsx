/** The trace viewer: every model call in a run, with what it sent and what came back. */
import React, { useEffect, useState } from 'react';
import type { AgentId, Run, RunTrace, TraceCall, TraceItem } from '../shared/types';
import { compareTraces } from '../shared/trace-diff';
import { api } from './api';
import { TraceCompare } from './trace-compare';
import { Note } from './ui';
import {
  contextSummary,
  kindLabel,
  outcomeText,
  readableText,
  resendShare,
  totalTokens,
} from './trace-format';

function Item({ item }: { item: TraceItem }) {
  const shortened = item.text !== undefined && item.chars > item.text.length;
  return (
    <li className={item.fresh === false ? 'resent' : undefined}>
      <div className="trace-item-head">
        <span className={`trace-kind kind-${item.kind}`}>{kindLabel[item.kind]}</span>
        {item.name && <code>{item.name}</code>}
        {item.fresh && <span className="trace-new">new</span>}
        {item.fresh === false && <span className="trace-resent">sent before</span>}
      </div>
      {item.text ? (
        <pre>{readableText(item)}</pre>
      ) : (
        item.kind === 'reasoning' && <p className="trace-note">Counted, never shown or stored.</p>
      )}
      {shortened && (
        <p className="trace-note">
          Showing the first {item.text!.length.toLocaleString()} of {item.chars.toLocaleString()}{' '}
          characters.
        </p>
      )}
    </li>
  );
}

function Call({
  call,
  name,
  open,
  botName,
}: {
  call: TraceCall;
  name: string;
  open: boolean;
  botName: (id: string) => string | undefined;
}) {
  const { percent, notes } = contextSummary(call);
  const usage = call.usage;
  return (
    <li>
      <details open={open || undefined}>
        <summary>
          <span className="trace-index">{call.index}</span>
          <span className="trace-headline">
            <strong>{name}</strong> {outcomeText(call, botName)}
          </span>
          <small>
            {(call.durationMs / 1000).toFixed(1)}s
            {usage && usage.totalTokens > 0
              ? ` · ${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out`
              : ''}
          </small>
        </summary>
        <div className="trace-body">
          {call.error && (
            <p role="alert" className="trace-error">
              {call.error}
            </p>
          )}
          <div className="trace-meter-row">
            <div className="trace-meter" role="img" aria-label={`Context window ${percent}% full`}>
              <span style={{ width: `${percent}%` }} />
            </div>
            <ul className="trace-notes">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
          <details className="trace-fold">
            <summary>Instructions ({call.instructionsChars.toLocaleString()} characters)</summary>
            <pre>{call.instructions}</pre>
            {call.instructionsChars > call.instructions.length && (
              <p className="trace-note">Shortened for display.</p>
            )}
          </details>
          <details className="trace-fold">
            <summary>Tools offered ({call.tools.length})</summary>
            <ul className="trace-tools">
              {call.tools.map((t) => (
                <li key={t.name}>
                  <code>{t.name}</code>
                  {t.type === 'hosted' && <span className="trace-note"> run by the provider</span>}
                  {t.parameters?.length ? (
                    <span className="trace-note"> ({t.parameters.join(', ')})</span>
                  ) : null}
                  {t.description && <p>{t.description}</p>}
                </li>
              ))}
            </ul>
          </details>
          <h3>Sent to the model</h3>
          {call.omittedItems > 0 && (
            <p className="trace-note">{call.omittedItems} older items are not shown.</p>
          )}
          <ol className="trace-items">
            {call.input.map((item, i) => (
              <Item item={item} key={i} />
            ))}
          </ol>
          <h3>The model replied</h3>
          {call.output.length ? (
            <ol className="trace-items">
              {call.output.map((item, i) => (
                <Item item={item} key={i} />
              ))}
            </ol>
          ) : (
            <p className="trace-note">Nothing came back.</p>
          )}
        </div>
      </details>
    </li>
  );
}

export function TraceView({
  run,
  nameFor,
  botName,
  others,
}: {
  run: Run;
  nameFor: (id: AgentId) => string;
  /** A bot in this task by ID, to name the bot an ask_ tool reached. */
  botName: (id: AgentId) => string | undefined;
  /** Other tasks this server has run, to compare with. Their traces are fetched when chosen. */
  others: { run: Run; label: string }[];
}) {
  const [trace, setTrace] = useState<RunTrace | null>(null);
  const [error, setError] = useState('');
  const [otherId, setOtherId] = useState('');
  const [other, setOther] = useState<RunTrace | null>(null);
  const [otherError, setOtherError] = useState('');
  const chosen = others.find((o) => o.run.id === otherId);
  useEffect(() => {
    setOther(null);
    setOtherError('');
    if (!chosen?.run.conversationId) return;
    let current = true;
    api<RunTrace>(`/conversations/${chosen.run.conversationId}/runs/${chosen.run.id}/trace`)
      .then(
        (t) =>
          current &&
          (t.available ? setOther(t) : setOtherError('This server has no trace for that task.')),
      )
      .catch((e: Error) => current && setOtherError(e.message));
    return () => {
      current = false;
    };
    // A finished task's trace does not change, so fetch it once per choice.
  }, [chosen?.run.id, chosen?.run.conversationId]);
  const modelCalls = run.usage?.modelCalls ?? 0;
  useEffect(() => {
    if (!run.conversationId) return;
    let current = true;
    api<RunTrace>(`/conversations/${run.conversationId}/runs/${run.id}/trace`)
      .then((t) => {
        if (!current) return;
        setTrace(t);
        setError('');
      })
      .catch((e: Error) => current && setError(e.message));
    return () => {
      current = false;
    };
    // Fetch again as the run makes more model calls or finishes.
  }, [run.id, run.conversationId, modelCalls, run.status]);

  if (!run.conversationId)
    return <p className="empty-state">This run is not attached to a conversation.</p>;
  if (error) return <p className="empty-state">{error}</p>;
  if (!trace) return <p className="empty-state">Loading the trace…</p>;
  if (!trace.available)
    return (
      <p className="empty-state">
        This server has no trace for this run. Traces stay in memory, so they disappear when the
        server restarts. Start a new task to see one.
      </p>
    );
  const share = resendShare(trace.calls),
    tokens = totalTokens(trace.calls);
  return (
    <div className="trace">
      <Note id="trace-intro" className="trace-intro">
        An agent has no memory between model calls. Every step sends everything again —
        instructions, tools, and the conversation so far — and the model answers with text or a tool
        call. Each row is one call.
      </Note>
      <p className="trace-summary">
        {trace.calls.length} {trace.calls.length === 1 ? 'call' : 'calls'}
        {tokens.input + tokens.output > 0
          ? ` · ${tokens.input.toLocaleString()} input / ${tokens.output.toLocaleString()} output tokens`
          : ' · the scripted demo model reports no tokens'}
        {share !== null && ` · ${share}% of what later calls sent had already been sent`}
      </p>
      {trace.truncated && (
        <p className="trace-note">
          The trace reached its size limit, so later calls are not shown.
        </p>
      )}
      {others.length > 0 && (
        <div className="trace-compare-pick">
          <label>
            Compare with another task
            <select value={otherId} onChange={(e) => setOtherId(e.target.value)}>
              <option value="">Choose a task…</option>
              {others.map((o) => (
                <option value={o.run.id} key={o.run.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {otherError && <p className="trace-note">{otherError}</p>}
          {chosen && !other && !otherError && <p className="trace-note">Loading that trace…</p>}
          {other && <TraceCompare diff={compareTraces(trace, other)} otherLabel={chosen!.label} />}
        </div>
      )}
      <ol className="trace-calls">
        {trace.calls.map((call, i) => (
          <Call
            key={call.index}
            call={call}
            name={nameFor(call.agent)}
            open={i === 0}
            botName={botName}
          />
        ))}
      </ol>
    </div>
  );
}
