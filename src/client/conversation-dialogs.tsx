/** Dialogs for starting a conversation with one bot and for renaming a conversation. */
import React from 'react';
import type { Persona } from '../shared/types';
import { character } from './profiles';
import { Avatar, Modal } from './ui';

export function NewConversationDialog({
  profiles,
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
          Start with your primary agent, or talk directly to an individual agent.
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
              <Avatar person={character(p)} size={38} />
              <span className="bot-option-copy">
                <strong>{p.name}</strong>
                <small>
                  {p.role === 'coordinator'
                    ? 'Primary agent · Can create and message agents'
                    : p.purpose}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="field-hint">
          Your primary agent can create individual agents and send them messages. You can open those
          conversations or speak with any agent directly.
        </p>
        <label className="field-label">
          Conversation name <span className="field-hint">Optional</span>
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
