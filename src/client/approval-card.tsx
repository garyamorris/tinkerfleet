/** The decision card for one exact pending action: an edit's diff or a command's argv. */
import React from 'react';
import type { Approval, Run } from '../shared/types';
import { Diff, Icon } from './ui';

export function ApprovalCard({
  a,
  mode,
  busy,
  agentName,
  workspaceRoot,
  onDecide,
}: {
  a: Approval;
  workspaceRoot: string;
  mode: Run['mode'];
  busy: boolean;
  agentName: string;
  onDecide: (approval: Approval, approved: boolean) => Promise<void>;
}) {
  return (
    <section className="approval-card" aria-label="Action awaiting your approval">
      <div className="approval-heading">
        <Icon name="shield" />
        <div>
          <span className="eyebrow">YOUR DECISION</span>
          <h3>{a.title}</h3>
        </div>
      </div>
      <p>
        {agentName} proposes this {a.action.kind === 'edit' ? 'edit' : 'command'}. {a.description}
      </p>
      {a.action.kind === 'edit' ? (
        <div className="artifact">
          <div className="diff-file">
            <Icon name="file" size={15} />
            {a.action.path}
          </div>
          <Diff before={a.before ?? ''} after={a.action.content} />
        </div>
      ) : (
        <pre className="command-line">
          Executable: {a.action.executable}
          {a.action.resolvedExecutable?.path && (
            <>
              {'\n'}Resolved path: {a.action.resolvedExecutable.path}
            </>
          )}
          {'\n'}Arguments: {JSON.stringify(a.action.args)}
          {'\n'}Working directory:{' '}
          {mode === 'demo' ? 'temporary copy of tiny-project' : workspaceRoot}
          {a.action.cwd && a.action.cwd !== '.' ? '/' + a.action.cwd : ''}
        </pre>
      )}
      {mode === 'live' && (
        <p className="local-action-note">
          Selected folder: <code>{workspaceRoot}</code>
          {a.action.kind === 'command' && (
            <>Commands run with your user permissions; this folder is not a sandbox.</>
          )}
        </p>
      )}
      <div className="approval-footnote">
        <span>
          {mode === 'demo'
            ? a.action.kind === 'edit'
              ? 'This changes a file in a temporary copy of tiny-project.'
              : 'This runs a real command in a temporary copy of tiny-project.'
            : a.action.kind === 'edit'
              ? 'This changes a real local file.'
              : 'This runs a real command with your user permissions.'}
        </span>
        <code title={a.digest}>#{a.digest.slice(0, 8)}</code>
      </div>
      <div className="actions">
        <button className="secondary" disabled={busy} onClick={() => onDecide(a, false)}>
          Decline
        </button>
        <button className="primary" disabled={busy} onClick={() => onDecide(a, true)}>
          Approve {a.action.kind === 'edit' ? 'edit' : 'command'}
        </button>
      </div>
    </section>
  );
}
