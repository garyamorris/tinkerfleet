import React, { useState } from 'react';
import { ConfirmButton, Note } from './ui';
export type MemoryItem = {
  id: string;
  agentId: string;
  text: string;
  createdAt: number;
  updatedAt: number;
};
export function MemoryPanel({
  name,
  entries,
  onAdd,
  onDelete,
}: {
  name: string;
  entries: MemoryItem[];
  onAdd: (text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const total = entries.reduce((sum, item) => sum + item.text.length, 0),
    full = entries.length >= 20;
  async function add() {
    if (busy || !text.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onAdd(text.trim());
      setText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onDelete(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Note id="memory-intro" className="modal-intro">
        {name}’s own memory, saved on this computer and reused across its conversations. Changing
        its personality does not erase these notes. Saved notes are sent to the model when this bot
        replies.
      </Note>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <ul className="memory-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <p>{entry.text}</p>
            <ConfirmButton
              label="Delete"
              prompt="Delete this note?"
              ariaLabel={`Delete memory: ${entry.text.slice(0, 70)}`}
              disabled={busy}
              onConfirm={() => remove(entry.id)}
            />
          </li>
        ))}
      </ul>
      {!entries.length && (
        <p className="memory-empty">
          No saved memories yet. Add a preference or useful fact, or ask this bot to remember one.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label className="field-label">
          Add a memory
          <textarea
            rows={3}
            maxLength={2000}
            value={text}
            disabled={busy || full}
            placeholder="For example, I prefer short explanations followed by one exercise."
            onChange={(e) => setText(e.target.value)}
          />
          <span className="field-hint">
            {entries.length}/20 notes · {total.toLocaleString()}/8,000 saved characters. Keep
            secrets out of memory.
          </span>
        </label>
        <div className="actions">
          <button
            className="primary"
            disabled={busy || full || !text.trim() || total + text.trim().length > 8000}
          >
            {busy ? 'Saving…' : 'Save memory'}
          </button>
        </div>
      </form>
    </>
  );
}
