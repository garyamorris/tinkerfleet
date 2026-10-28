/** Dialogs for starting, renaming, inspecting, and deleting a conversation. */
import React from 'react';
import type { Persona } from '../shared/types';
import { withLibraryCapabilities, type ServerCapabilities } from '../shared/capabilities';
import { CapabilitySummary } from './bot-dialogs';
import { character } from './profiles';
import { Avatar, Modal } from './ui';

export function NewConversationDialog({
  profiles,
  server,
  chosen,
  title,
  error,
  creating,
  onChoose,
  onTitle,
  onSubmit,
  onClose,
}: {
  profiles: Persona[];
  server: ServerCapabilities;
  chosen: string[];
  title: string;
  error: string;
  creating: boolean;
  onChoose: (id: string) => void;
  onTitle: (title: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Talk to a bot" onClose={() => onClose()}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <p className="modal-intro">
          Start a separate conversation, for example to keep a new topic apart. Pick your primary
          bot or talk to any bot directly.
        </p>
        {error && (
          <p role="alert" className="error-banner">
            {error}
          </p>
        )}
        <fieldset className="participant-picker">
          <legend className="sr-only">Choose one bot</legend>
          {profiles.map((p) => (
            <label className="bot-option" key={p.id}>
              <input
                type="radio"
                name="conversation-bot"
                value={p.id}
                checked={chosen[0] === p.id}
                onChange={() => onChoose(p.id)}
              />
              <Avatar person={character(p)} size={36} />
              <span className="bot-option-copy">
                <strong>
                  {p.name}
                  {p.role === 'coordinator' && <span className="byline-badge">Primary</span>}
                </strong>
                <small>
                  {p.role === 'coordinator' ? 'Can create bots and hand them work.' : p.purpose}
                </small>
                <CapabilitySummary profile={p} server={server} />
              </span>
            </label>
          ))}
        </fieldset>
        <label className="field-label">
          <span>
            Conversation name <span className="field-hint">(optional)</span>
          </span>
          <input
            maxLength={80}
            value={title}
            placeholder="For example, Planning my project"
            onChange={(e) => onTitle(e.target.value)}
          />
        </label>
        <div className="actions">
          <button className="secondary" type="button" onClick={() => onClose()}>
            Cancel
          </button>
          <button className="primary" disabled={creating || !chosen.length}>
            {creating ? 'Starting…' : 'Start conversation'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function RenameDialog({
  title,
  error,
  creating,
  onTitle,
  onSubmit,
  onClose,
}: {
  title: string;
  error: string;
  creating: boolean;
  onTitle: (title: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Rename conversation" onClose={() => onClose()}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {error && (
          <p role="alert" className="error-banner">
            {error}
          </p>
        )}
        <label className="field-label">
          Name
          <input required maxLength={80} value={title} onChange={(e) => onTitle(e.target.value)} />
        </label>
        <div className="actions">
          <button type="button" className="secondary" onClick={() => onClose()}>
            Cancel
          </button>
          <button className="primary" disabled={creating || !title.trim()}>
            Save name
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Each participant's tools in this conversation, after the server's switches. */
export function CapabilitiesDialog({
  participants,
  profiles,
  server,
  onClose,
}: {
  participants: Persona[];
  profiles: Persona[];
  server: ServerCapabilities;
  onClose: () => void;
}) {
  return (
    <Modal title="What each bot can do" onClose={onClose}>
      <ul className="capability-list">
        {participants.map((p) => (
          <li key={p.id}>
            <Avatar person={character(p)} size={30} />
            <span>
              <strong>{p.name}</strong>
              <CapabilitySummary profile={withLibraryCapabilities(p, profiles)} server={server} />
            </span>
          </li>
        ))}
      </ul>
      <p className="field-hint">
        Capabilities are set in the Bot library and apply at once, in this conversation too.
      </p>
      <div className="actions">
        <button className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

export function DeleteConversationDialog({
  title,
  busy,
  error,
  deleting,
  onDelete,
  onClose,
}: {
  title: string;
  /** A task is still running or waiting for approval here. */
  busy: boolean;
  error: string;
  deleting: boolean;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Delete conversation?" onClose={onClose}>
      <p className="modal-intro">
        “{title}” and its tasks, approvals, and outputs will be removed from this workspace. Your
        bots, their memory, and any group it started stay.
      </p>
      {busy && (
        <p className="capability-warning" role="note">
          A task here is still running or waiting for you. Stop it first.
        </p>
      )}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary danger"
          disabled={busy || deleting}
          onClick={onDelete}
        >
          {deleting ? 'Deleting…' : 'Delete conversation'}
        </button>
      </div>
    </Modal>
  );
}
