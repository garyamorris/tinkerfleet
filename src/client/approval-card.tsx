/** The decision card for one exact pending action: an edit's diff or a command's argv. */
import React from 'react';
import type { Approval, Run } from '../shared/types';
import { Diff, Icon, commandLine } from './ui';

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
  const edit = a.action.kind === 'edit';
  const folder =
    mode === 'demo'
      ? 'a temporary copy of tiny-project'
      : `${workspaceRoot}${a.action.kind === 'command' && a.action.cwd && a.action.cwd !== '.' ? '/' + a.action.cwd : ''}`;
  // What approving actually does, in one sentence for this mode and kind of action.
  const consequence =
    mode === 'demo'
      ? edit
        ? 'Approving writes this change to a temporary copy of tiny-project. Your own files are not touched.'
        : 'Approving runs this real command in a temporary copy of tiny-project, with your user permissions.'
      : edit
        ? 'Approving writes this change to a real file in the selected folder.'
        : 'Approving runs this real command with your user permissions. The folder is not a sandbox.';
  return (
    <section className="approval-card" aria-label="Action awaiting your approval">
      <div className="approval-heading">
        <Icon name="shield" />
        <div>
          <span className="eyebrow">Your decision</span>
          <h2>{a.title}</h2>
        </div>
      </div>
      <p>
        {agentName} proposes this {edit ? 'edit' : 'command'}. {a.description}
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
        <div className="command-card">
          <pre className="command-line">
            <span aria-hidden="true">$ </span>
            {commandLine(a.action.executable, a.action.args)}
          </pre>
          <dl className="command-facts">
            <div>
              <dt>In</dt>
              <dd>{folder}</dd>
            </div>
            {a.action.resolvedExecutable?.path && (
              <div>
                <dt>Program</dt>
                <dd>{a.action.resolvedExecutable.path}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
      <p className="approval-consequence">{consequence}</p>
      <details className="approval-exact">
        <summary>Exact action</summary>
        <dl className="command-facts">
          {a.action.kind === 'command' ? (
            <>
              <div>
                <dt>Executable</dt>
                <dd>{a.action.executable}</dd>
              </div>
              <div>
                <dt>Arguments</dt>
                <dd>{JSON.stringify(a.action.args)}</dd>
              </div>
            </>
          ) : (
            <div>
              <dt>File</dt>
              <dd>{a.action.path}</dd>
            </div>
          )}
          {mode === 'live' && (
            <div>
              <dt>Selected folder</dt>
              <dd>{workspaceRoot}</dd>
            </div>
          )}
          <div>
            <dt>Approval ID</dt>
            <dd>{a.digest}</dd>
          </div>
        </dl>
        <p>This approval works once, for exactly this action. Any change needs a new approval.</p>
      </details>
      <div className="actions">
        <button className="secondary" disabled={busy} onClick={() => onDecide(a, false)}>
          Decline
        </button>
        <button className="primary" disabled={busy} onClick={() => onDecide(a, true)}>
          Approve {edit ? 'edit' : 'command'}
        </button>
      </div>
    </section>
  );
}
