/** Compare two runs: where they first did something different, and what else changed. */
import React from 'react';
import type { TraceCall } from '../shared/types';
import type { CallPair, TraceDiff } from '../shared/trace-diff';
import { argsOf, outcomeText, verdict } from './trace-format';
import { Diff } from './ui';

const tokens = (n: number) => (n ? n.toLocaleString() : '-');

function Row({ pair }: { pair: CallPair }) {
  const cell = (call?: TraceCall) =>
    call ? (
      <>
        {outcomeText(call)}
        {call.usage && call.usage.inputTokens > 0 && (
          <small> · {call.usage.inputTokens.toLocaleString()} in</small>
        )}
        {!pair.sameMove && argsOf(call) && <code className="trace-args">{argsOf(call)}</code>}
      </>
    ) : (
      <em>no call</em>
    );
  return (
    <tr className={pair.sameMove ? undefined : 'differs'}>
      <th scope="row">{pair.index}</th>
      <td>{cell(pair.a)}</td>
      <td>{cell(pair.b)}</td>
    </tr>
  );
}

export function TraceCompare({ diff, otherLabel }: { diff: TraceDiff; otherLabel: string }) {
  const used = (tools: { name: string; count: number }[]) =>
    tools.length
      ? tools.map((t) => `${t.name}${t.count > 1 ? ` ×${t.count}` : ''}`).join(', ')
      : 'none';
  const { onlyA, onlyB } = diff.tools;
  return (
    <section className="trace-compare" aria-label="Comparison with another task">
      <p className="trace-verdict" role="status">
        {verdict(diff)}
      </p>
      <table className="trace-totals">
        <caption className="visually-hidden">Totals for each task</caption>
        <thead>
          <tr>
            <td />
            <th scope="col">This task</th>
            <th scope="col" title={otherLabel}>
              The other task
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Model calls</th>
            <td>{diff.a.calls}</td>
            <td>{diff.b.calls}</td>
          </tr>
          <tr>
            <th scope="row">Input tokens</th>
            <td>{tokens(diff.a.inputTokens)}</td>
            <td>{tokens(diff.b.inputTokens)}</td>
          </tr>
          <tr>
            <th scope="row">Output tokens</th>
            <td>{tokens(diff.a.outputTokens)}</td>
            <td>{tokens(diff.b.outputTokens)}</td>
          </tr>
          <tr>
            <th scope="row">Time</th>
            <td>{diff.a.seconds.toFixed(1)}s</td>
            <td>{diff.b.seconds.toFixed(1)}s</td>
          </tr>
          <tr>
            <th scope="row">Tools called</th>
            <td>{used(diff.a.tools)}</td>
            <td>{used(diff.b.tools)}</td>
          </tr>
        </tbody>
      </table>
      <ul className="trace-changes">
        {diff.instructions.same ? (
          <li>Instructions: the same.</li>
        ) : (
          <li>
            <details>
              <summary>Instructions differ</summary>
              <Diff before={diff.instructions.a} after={diff.instructions.b} />
              <p className="trace-note">
                Red is this task’s first call; green is the other task’s.
              </p>
            </details>
          </li>
        )}
        <li>
          Tools offered:{' '}
          {onlyA.length || onlyB.length
            ? [
                onlyA.length ? `only this task had ${onlyA.join(', ')}` : '',
                onlyB.length ? `only the other had ${onlyB.join(', ')}` : '',
              ]
                .filter(Boolean)
                .join('; ')
            : 'the same.'}
        </li>
        <li>
          Settings:{' '}
          {diff.settings.length
            ? diff.settings
                .map((s) => `${s.key} ${s.a ?? 'default'} → ${s.b ?? 'default'}`)
                .join('; ')
            : 'the same.'}
        </li>
      </ul>
      <table className="trace-pairs">
        <caption className="visually-hidden">What each task did, call by call</caption>
        <thead>
          <tr>
            <th scope="col">Call</th>
            <th scope="col">This task</th>
            <th scope="col">The other task</th>
          </tr>
        </thead>
        <tbody>
          {diff.pairs.map((pair) => (
            <Row pair={pair} key={pair.index} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
