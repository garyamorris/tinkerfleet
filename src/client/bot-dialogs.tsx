/** The bot library, where profiles live, and the editor for one bot's name, purpose and look. */
import React from 'react';
import type { Persona } from '../shared/types';
import {
  appearanceColors as colors,
  appearanceShapes as shapes,
  randomAppearance,
} from '../shared/appearance';
import {
  CAPABILITIES,
  canLeakWorkspace,
  capabilityInfo,
  enabledCapabilities,
  grantedCapabilities,
  normalizeCapabilities,
  type ServerCapabilities,
} from '../shared/capabilities';
import { agentLabel, character, type Library } from './profiles';
import { Avatar, Icon, Modal } from './ui';

const LEAK_WARNING =
  'Read files and Web together can leak workspace files: text planted in a file or page can ask the model to put file contents into a search. Give them to different bots unless you trust the project and the sites.';

/** A bot's capabilities as short labels. Groups the server has switched off are marked. */
export function CapabilitySummary({
  profile,
  server,
}: {
  profile: Persona;
  server: ServerCapabilities;
}) {
  const granted = grantedCapabilities(profile, server);
  const off = (profile.capabilities ?? []).filter((c) => !granted.includes(c));
  return (
    <span className="capability-summary">
      {granted.length
        ? granted.map((c) => capabilityInfo[c].label).join(' · ')
        : 'Chat only, no tools'}
      {profile.capabilities === undefined && ' (all enabled tools: saved before capabilities)'}
      {off.length > 0 &&
        ` · off on this server: ${off.map((c) => capabilityInfo[c].label).join(', ')}`}
      {canLeakWorkspace(granted) && (
        <span className="capability-warning" title={LEAK_WARNING}>
          {' '}
          · read + web
        </span>
      )}
    </span>
  );
}

export function BotLibraryDialog({
  profiles,
  server,
  legacyLibrary,
  importError,
  creating,
  onEdit,
  onCreate,
  onMemory,
  onTalk,
  onClose,
}: {
  profiles: Persona[];
  server: ServerCapabilities;
  legacyLibrary: Library;
  importError: string;
  creating: boolean;
  onEdit: (profile: Persona) => void;
  onCreate: () => void;
  onMemory: (profile: Persona) => void;
  onTalk: (profile: Persona) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Bot library" onClose={() => onClose()}>
      <p className="modal-intro">
        Reusable bots with personalities and purposes you choose. Your primary agent can create
        agents here too. Try asking: “Create a patient Python tutor called Ada.”
      </p>
      {importError && (
        <details className="legacy-bot-backup" open>
          <summary>Browser backup · {legacyLibrary.profiles.length} bots</summary>
          <p role="alert">{importError}</p>
          <button
            className="secondary"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(legacyLibrary, null, 2)], {
                  type: 'application/json',
                }),
              );
              const a = document.createElement('a');
              a.href = url;
              a.download = 'tinkerfleet-browser-bots-backup.json';
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 60000);
            }}
          >
            Export browser backup
          </button>
          <p className="field-hint">
            These profiles are kept here for recovery. The saved library below is unchanged. Import
            up to 32 profiles after reconciling your backup.
          </p>
          <ul>
            {legacyLibrary.profiles.map((p) => (
              <li key={p.id}>
                <Avatar person={character(p)} size={26} />
                <div>
                  <strong>{p.name}</strong>
                  <span>{agentLabel(p)}</span>
                  <p>{p.purpose}</p>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="team-slots">
        {profiles.map((p) => (
          <section className="team-slot" key={p.id}>
            <Avatar person={character(p)} size={42} />
            <div className="slot-content">
              <div className="slot-select">
                <strong>
                  {p.name}
                  <span className="library-role">{agentLabel(p)}</span>
                </strong>
                <button
                  className="secondary"
                  aria-label={`Edit ${p.name}`}
                  onClick={() => onEdit(p)}
                >
                  Edit
                </button>
              </div>
              <p>{p.purpose}</p>
              <CapabilitySummary profile={p} server={server} />
              <button className="text-button bot-memory-button" onClick={() => onMemory(p)}>
                Memory
              </button>
              <button
                className="text-button talk-to-bot"
                disabled={creating}
                onClick={() => onTalk(p)}
              >
                Talk to {p.name}
                <Icon name="chevron" size={13} />
              </button>
            </div>
          </section>
        ))}
      </div>
      <div className="panel-note">
        Bots are saved with this workspace and stay in sync. Existing conversations keep their
        original profiles; new conversations use your latest changes. Removing a capability applies
        at once, in existing conversations too.
      </div>
      <div className="actions">
        <button className="secondary" onClick={onCreate}>
          <Icon name="plus" size={16} />
          Create persona
        </button>
        <button className="primary" onClick={() => onClose()}>
          Done
        </button>
      </div>
    </Modal>
  );
}

export function PersonaEditorDialog({
  draft,
  server,
  isNew,
  error,
  saving,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: Persona;
  server: ServerCapabilities;
  isNew: boolean;
  error: string;
  saving: boolean;
  onChange: (draft: Persona) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={isNew ? 'Create a persona' : 'Edit persona'} onClose={() => onCancel()}>
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
        <div className="profile-form">
          <div className="persona-avatar">
            <Avatar person={character(draft)} size={76} />
          </div>
          <label className="field-label">
            Name
            <input
              required
              maxLength={40}
              value={draft.name}
              autoComplete="off"
              placeholder="For example, Accessibility Scout"
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="field-label full">
            Personality & purpose
            <textarea
              required
              rows={4}
              maxLength={600}
              value={draft.purpose}
              placeholder="Describe its personality, expertise, tone, and what it should help you do."
              onChange={(e) => onChange({ ...draft, purpose: e.target.value })}
            />
            <span className="field-hint">
              {draft.purpose.length}/600 · Guides live model behavior. The demo remains scripted.
            </span>
          </label>
          <fieldset className="appearance full">
            <legend>Appearance</legend>
            <button
              type="button"
              className="secondary"
              onClick={() => onChange({ ...draft, ...randomAppearance(draft) })}
            >
              Randomize avatar
            </button>
            <div className="color-options">
              {[...new Set([...colors, draft.color.toLowerCase()])].map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  aria-pressed={draft.color.toLowerCase() === c}
                  style={{ background: c }}
                  onClick={() => onChange({ ...draft, color: c })}
                >
                  {draft.color.toLowerCase() === c && <Icon name="check" size={15} />}
                </button>
              ))}
            </div>
            <div className="shape-options">
              {shapes.map((shape) => (
                <button
                  key={shape}
                  type="button"
                  aria-label={`${shape} shape`}
                  aria-pressed={draft.shape === shape}
                  onClick={() => onChange({ ...draft, shape })}
                >
                  <Avatar person={character({ ...draft, shape })} size={32} />
                </button>
              ))}
            </div>
          </fieldset>
          <CapabilityPicker draft={draft} server={server} onChange={onChange} />
        </div>
        <p className="panel-note">
          Personality guides how an agent works; capabilities decide which tools it gets. The
          server’s settings still cap them. Every file edit and command requires your approval. Keep
          secrets out of the personality.
        </p>
        <div className="actions">
          <button type="button" className="secondary" onClick={() => onCancel()}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={saving || !draft.name.trim() || !draft.purpose.trim()}
          >
            {saving ? 'Saving…' : 'Save persona'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CapabilityPicker({
  draft,
  server,
  onChange,
}: {
  draft: Persona;
  server: ServerCapabilities;
  onChange: (draft: Persona) => void;
}) {
  const chosen = draft.capabilities ?? [...CAPABILITIES];
  const enabled = enabledCapabilities(server);
  return (
    <fieldset className="capabilities full">
      <legend>Capabilities</legend>
      <p className="field-hint">
        Give this bot only the tools its work needs. Adding one applies to new conversations;
        removing one applies at once.
      </p>
      {CAPABILITIES.map((c) => (
        <label key={c} className="capability-option">
          <input
            type="checkbox"
            checked={chosen.includes(c)}
            onChange={(e) =>
              onChange({
                ...draft,
                capabilities: normalizeCapabilities(
                  e.target.checked ? [...chosen, c] : chosen.filter((x) => x !== c),
                ),
              })
            }
          />
          <span>
            <strong>{capabilityInfo[c].label}</strong>
            <span className="field-hint">
              {capabilityInfo[c].about} <code>{capabilityInfo[c].tools}</code>
              {!enabled.includes(c) && ' · Off on this server, so not available yet.'}
            </span>
          </span>
        </label>
      ))}
      {canLeakWorkspace(chosen) && (
        <p className="capability-warning" role="note">
          {LEAK_WARNING}
        </p>
      )}
    </fieldset>
  );
}
