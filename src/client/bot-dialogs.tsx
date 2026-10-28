/** The bot library, where profiles live, and the editor for one bot's name, purpose and look. */
import React from 'react';
import type { Capability, Persona, ScheduleView } from '../shared/types';
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
import { Avatar, ConfirmButton, Icon, Modal, Note } from './ui';

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
        ` · ${off.map((c) => capabilityInfo[c].label).join(', ')} off on this server`}
      {canLeakWorkspace(granted) && (
        <span className="capability-warning" title={LEAK_WARNING}>
          {' '}
          · read + web
        </span>
      )}
    </span>
  );
}

/**
 * Under a "Created …" message: what the new bot can do, and the capabilities it asked for that wait
 * for your OK. Granting saves them on the bot's profile, the same as ticking them in the library.
 */
export function CreatedBotCapabilities({
  bot,
  requested,
  server,
  onGrant,
}: {
  bot: Persona;
  requested: Capability[];
  server: ServerCapabilities;
  onGrant: (bot: Persona, capabilities: Capability[]) => Promise<void>;
}) {
  const [saving, setSaving] = React.useState(false),
    [error, setError] = React.useState('');
  const has = bot.capabilities ?? CAPABILITIES;
  const waiting = requested.filter((c) => !has.includes(c));
  const after = normalizeCapabilities([...has, ...waiting]);
  const names = (list: readonly Capability[]) => list.map((c) => capabilityInfo[c].label);
  return (
    <div className="created-capabilities">
      <span>
        {bot.name} can use: <CapabilitySummary profile={bot} server={server} />
      </span>
      {waiting.length > 0 && (
        <div className="capability-request" role="group" aria-label="Capabilities waiting for you">
          <p>
            {bot.name} also asked for <strong>{names(waiting).join(' and ')}</strong>. A bot your
            primary creates starts without {waiting.length > 1 ? 'these' : 'it'} until you grant{' '}
            {waiting.length > 1 ? 'them' : 'it'}.
          </p>
          {canLeakWorkspace(after) && <p className="capability-warning">{LEAK_WARNING}</p>}
          {error && <p role="alert">{error}</p>}
          <button
            className="secondary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError('');
              try {
                await onGrant(bot, after);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'Granting…' : `Grant ${names(waiting).join(' and ')}`}
          </button>
        </div>
      )}
    </div>
  );
}

export function BotLibraryDialog({
  profiles,
  schedules,
  server,
  legacyLibrary,
  importError,
  creating,
  onEdit,
  onCreate,
  onMemory,
  onSchedule,
  onTalk,
  onClose,
}: {
  profiles: Persona[];
  schedules: ScheduleView[];
  server: ServerCapabilities;
  legacyLibrary: Library;
  importError: string;
  creating: boolean;
  onEdit: (profile: Persona) => void;
  onCreate: () => void;
  onMemory: (profile: Persona) => void;
  onSchedule: (profile: Persona) => void;
  onTalk: (profile: Persona) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Bot library" onClose={() => onClose()}>
      <Note id="library-intro" className="modal-intro">
        Each bot has its own personality, tools, and memory. Your primary bot can create bots too;
        try asking it: “Create a patient Python tutor called Ada.”
      </Note>
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
                  {agentLabel(p) && <span>{agentLabel(p)}</span>}
                  <p>{p.purpose}</p>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="team-slots">
        {profiles.map((p) => {
          const count = schedules.filter((s) => s.botId === p.id).length;
          return (
            <section className="team-slot" key={p.id} aria-label={p.name}>
              <Avatar person={character(p)} size={40} />
              <div className="slot-content">
                <div className="slot-head">
                  <h3>
                    {p.name}
                    {agentLabel(p) && <span className="byline-badge">{agentLabel(p)}</span>}
                  </h3>
                  <button className="secondary" disabled={creating} onClick={() => onTalk(p)}>
                    Talk to {p.name}
                    <Icon name="forward" size={15} />
                  </button>
                </div>
                <p>{p.purpose}</p>
                <span className="capability-line">
                  Can use: <CapabilitySummary profile={p} server={server} />
                </span>
                <div className="slot-actions">
                  <button
                    className="text-button"
                    aria-label={`Edit ${p.name}`}
                    onClick={() => onEdit(p)}
                  >
                    <Icon name="edit" size={15} />
                    Edit
                  </button>
                  <button
                    className="text-button"
                    aria-label={`Memory for ${p.name}`}
                    onClick={() => onMemory(p)}
                  >
                    <Icon name="book" size={15} />
                    Memory
                  </button>
                  {p.role !== 'coordinator' && (
                    <button
                      className="text-button"
                      aria-label={`Schedules for ${p.name}${count ? `, ${count} saved` : ''}`}
                      onClick={() => onSchedule(p)}
                    >
                      <Icon name="clock" size={15} />
                      Schedules{count > 0 && ` · ${count}`}
                    </button>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>
      <Note id="library-sync">
        Existing conversations keep the name and personality a bot had when they started; new
        conversations use your latest changes. Capabilities are different: a change applies at once,
        in existing conversations too.
      </Note>
      <div className="actions">
        <button className="secondary" onClick={onCreate}>
          <Icon name="plus" size={16} />
          Create bot
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
  onDelete,
  onCancel,
}: {
  draft: Persona;
  server: ServerCapabilities;
  isNew: boolean;
  error: string;
  saving: boolean;
  onChange: (draft: Persona) => void;
  onSubmit: () => void;
  /** Missing for a new bot and for the primary, which cannot be deleted. */
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={isNew ? 'Create a bot' : `Edit ${draft.name.trim() || 'bot'}`}
      onClose={() => onCancel()}
    >
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
            <Avatar person={character(draft)} size={72} />
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
              Keep secrets out of it.
            </span>
          </label>
          <fieldset className="appearance full">
            <legend>Appearance</legend>
            <div className="appearance-row">
              <span className="appearance-label" id="appearance-color">
                Color
              </span>
              <div className="color-options" role="group" aria-labelledby="appearance-color">
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
            </div>
            <div className="appearance-row">
              <span className="appearance-label" id="appearance-shape">
                Shape
              </span>
              <div className="shape-options" role="group" aria-labelledby="appearance-shape">
                {shapes.map((shape) => (
                  <button
                    key={shape}
                    type="button"
                    aria-label={`${shape} shape`}
                    aria-pressed={draft.shape === shape}
                    onClick={() => onChange({ ...draft, shape })}
                  >
                    <Avatar person={character({ ...draft, shape })} size={30} />
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => onChange({ ...draft, ...randomAppearance(draft) })}
              >
                Randomize avatar
              </button>
            </div>
          </fieldset>
          <CapabilityPicker draft={draft} server={server} onChange={onChange} />
        </div>
        <Note id="editor-capabilities">
          Personality guides how a bot works; capabilities decide which tools it gets. The server’s
          settings still cap them, and every file edit and command still needs your approval.
        </Note>
        <div className="actions">
          {onDelete && (
            <span className="actions-start">
              <ConfirmButton
                label={
                  <>
                    <Icon name="trash" size={15} />
                    Delete bot
                  </>
                }
                prompt={`Delete ${draft.name.trim() || 'this bot'}, its schedules and memory?`}
                disabled={saving}
                onConfirm={onDelete}
              />
            </span>
          )}
          <button type="button" className="secondary" onClick={() => onCancel()}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={saving || !draft.name.trim() || !draft.purpose.trim()}
          >
            {saving ? 'Saving…' : isNew ? 'Create bot' : 'Save changes'}
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
        Give this bot only the tools its work needs. Saved changes apply at once, in existing
        conversations too.
      </p>
      {CAPABILITIES.map((c) => (
        <label key={c} className={`capability-option${enabled.includes(c) ? '' : ' unavailable'}`}>
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
            <strong>
              {capabilityInfo[c].label}
              {!enabled.includes(c) && <span className="badge neutral">Off on this server</span>}
            </strong>
            <span className="field-hint">
              {capabilityInfo[c].about} <code>{capabilityInfo[c].tools}</code>
              {!enabled.includes(c) &&
                ' You can choose it now; it starts working when the server turns it on.'}
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
