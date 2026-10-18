/** What this workspace can do: mode, model, tools, budgets, and the approval rule. */
import React from 'react';
import type { AppState } from '../shared/types';
import { Modal } from './ui';

export function SettingsDialog({
  state,
  onClose,
}: {
  state: AppState | null;
  onClose: () => void;
}) {
  return (
    <Modal title="Workspace & safety" onClose={() => onClose()}>
      <p className="modal-intro">
        {state?.mode === 'live'
          ? 'Live model calls use the configured provider.'
          : 'The demo uses a scripted model, so it makes no API calls. Its tools are real: approved edits and commands act on a temporary copy of tiny-project, deleted when the server stops.'}
      </p>
      <dl className="settings-list">
        <div>
          <dt>Workspace</dt>
          <dd>{state?.workspaceRoot ?? 'Connecting…'}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>
            {state?.mode === 'demo' ? 'Scripted demo model' : (state?.model ?? 'None connected')}
          </dd>
        </div>
        {state?.mode === 'live' && state.reasoningEffort && (
          <div>
            <dt>Reasoning effort</dt>
            <dd>{state.reasoningEffort}</dd>
          </div>
        )}
        {state?.mode === 'live' && (
          <div>
            <dt>Web search</dt>
            <dd>{state.webSearchEnabled ? 'Enabled · public web sources' : 'Off'}</dd>
          </div>
        )}
        <div>
          <dt>File tools</dt>
          <dd>
            {state?.mode === 'demo'
              ? 'Temporary copy · exact approval required'
              : state?.workspaceToolsEnabled
                ? 'Local · exact approval required'
                : 'Off · no file access or commands'}
          </dd>
        </div>
        <div>
          <dt>Command execution</dt>
          <dd>
            {state?.mode === 'demo' && state.execution.available
              ? 'Temporary copy · your user permissions'
              : !state?.workspaceToolsEnabled
                ? 'Off · chat only'
                : state?.execution.available
                  ? 'Local · your user permissions'
                  : (state?.execution.reason ?? 'Unavailable')}
          </dd>
        </div>
        <div>
          <dt>Local files</dt>
          <dd>
            {state?.mode === 'demo'
              ? 'Yours are unchanged · only the temporary copy is edited'
              : state?.workspaceToolsEnabled
                ? 'Approved edits change real files'
                : 'Unchanged · file tools off'}
          </dd>
        </div>
        <div>
          <dt>Turn limit</dt>
          <dd>{state?.maxTurns === 0 ? 'No turn limit' : (state?.maxTurns ?? 'Connecting…')}</dd>
        </div>
        <div>
          <dt>Model calls per task</dt>
          <dd>
            {state?.limits.maxModelCalls === 0
              ? 'No count limit'
              : (state?.limits.maxModelCalls ?? 'Connecting…')}
          </dd>
        </div>
        <div>
          <dt>Output tokens per call</dt>
          <dd>{state?.limits.maxOutputTokens.toLocaleString() ?? 'Connecting…'}</dd>
        </div>
        <div>
          <dt>Total tokens per task</dt>
          <dd>{state?.limits.maxTotalTokens.toLocaleString() ?? 'Connecting…'}</dd>
        </div>
        <div>
          <dt>Time budget per task</dt>
          <dd>
            {state
              ? `${(state.limits.maxRunMs / 60000).toLocaleString(undefined, { maximumFractionDigits: 2 })} minutes`
              : 'Connecting…'}
          </dd>
        </div>
        <div>
          <dt>Approval</dt>
          <dd>One exact action, one use</dd>
        </div>
      </dl>
      <p className="panel-note">
        Live chat sends persona purposes, saved memories, and conversation context to the model
        provider. File content and tool results are sent only when workspace tools are enabled.
        Commands run with your user permissions; this folder is not a sandbox. Credentials belong in
        secure server configuration.
      </p>
      <div className="actions">
        <button className="primary" onClick={() => onClose()}>
          Got it
        </button>
      </div>
    </Modal>
  );
}
