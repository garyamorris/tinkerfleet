/**
 * Small shared UI pieces: icons, avatars, diffs, the modal dialog, menus, notes, and run status
 * labels.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import type { Run } from '../shared/types';
import type { Person } from './profiles';

export const statusText = {
  idle: 'Ready when you are',
  running: 'Working',
  awaiting_approval: 'Waiting for you',
  completed: 'Run complete',
  denied: 'Action declined',
  cancelled: 'Stopped',
  failed: 'Needs attention',
};

/** How a finished task ended, in words and a tone. A task with a declined action is no success. */
export function runOutcome(run: Run): {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
} {
  const declined = run.approvals.filter((a) => a.status === 'denied').length;
  if (run.status === 'completed' && declined)
    return {
      label: `Finished · you declined ${declined === 1 ? 'an action' : `${declined} actions`}`,
      tone: 'warning',
    };
  if (run.status === 'completed') return { label: statusText.completed, tone: 'success' };
  if (run.status === 'failed') return { label: statusText.failed, tone: 'danger' };
  if (run.status === 'denied') return { label: statusText.denied, tone: 'warning' };
  return { label: statusText[run.status], tone: 'neutral' };
}

/** A command as one line you could type. Arguments a shell would split or expand are quoted. */
export function commandLine(executable: string, args: readonly string[]): string {
  const quote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  return [executable, ...args].map(quote).join(' ');
}

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="m6 12 6-6 6 6M12 6v14" />,
    forward: <path d="M5 12h14M13 6l6 6-6 6" />,
    down: <path d="M12 5v14M6 13l6 6 6-6" />,
    edit: (
      <>
        <path d="M4 20h4L19 9l-4-4L4 16Z" />
        <path d="m13 7 4 4" />
      </>
    ),
    trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
    more: (
      <g fill="currentColor" stroke="none">
        <circle cx="5" cy="12" r="1.7" />
        <circle cx="12" cy="12" r="1.7" />
        <circle cx="19" cy="12" r="1.7" />
      </g>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    check: <path d="m5 12 4 4 10-10" />,
    book: (
      <>
        <path d="M3 4h6c2 0 3 1 3 2 0-1 1-2 3-2h6v15h-6c-2 0-3 1-3 2 0-1-1-2-3-2H3Z" />
        <path d="M12 6v15" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    terminal: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="m7 9 3 3-3 3M13 15h4" />
      </>
    ),
    file: (
      <>
        <path d="M14 3H5v18h14V8Z M14 3v5h5" />
        <path d="M8 12h8M8 16h5" />
      </>
    ),
    activity: <path d="M2 12h5l3-8 4 16 3-8h5" />,
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m12 2 2 3 4-1 1 4 3 2-2 4 1 4-4 1-3 3-3-2-4 1-1-4-3-3 2-3-1-4 4-1Z" />
      </>
    ),
    back: <path d="m15 5-7 7 7 7" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    team: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7v1" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3 10 5-10 5L2 8Z M2 12l10 5 10-5M2 16l10 5 10-5" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.info}
    </svg>
  );
}
export function Avatar({ person, size = 42 }: { person: Person; size?: number }) {
  return (
    <span
      className={`avatar avatar-${person.shape}`}
      style={{ width: size, height: size, '--agent-color': person.color } as React.CSSProperties}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64">
        <defs>
          <linearGradient id={`shine-${person.id}-${size}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="white" stopOpacity=".22" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
        </defs>
        {person.shape === 'orbit' ? (
          <circle cx="32" cy="32" r="28" fill={person.color} />
        ) : person.shape === 'spark' ? (
          <path
            d="M32 3 42 18 59 22 52 39 52 54 34 59 19 52 5 39 12 20 25 15Z"
            fill={person.color}
          />
        ) : person.shape === 'pebble' ? (
          <path
            d="M12 11C23 2 48 5 54 17c6 12 5 29-4 37-11 9-32 6-40-5C2 38 2 20 12 11Z"
            fill={person.color}
          />
        ) : (
          <path
            d="M25 4c4-3 10-3 14 0l19 20c4 4 4 10 0 14L39 59c-4 3-10 3-14 0L6 38c-4-4-4-10 0-14Z"
            fill={person.color}
          />
        )}
        <circle cx="28" cy="22" r="18" fill={`url(#shine-${person.id}-${size})`} />
        <rect x="22" y="26" width="6" height="9" rx="3" fill="#fff" />
        <rect x="36" y="26" width="6" height="9" rx="3" fill="#fff" />
        <path
          d="M27 41q5 3 10-1"
          fill="none"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
          opacity=".85"
        />
      </svg>
    </span>
  );
}
/** A few overlapping avatars, then "+N" for the rest. */
export function AvatarStack({
  people,
  size,
  max = 3,
}: {
  people: Person[];
  size: number;
  max?: number;
}) {
  const shown = people.slice(0, max),
    extra = people.length - shown.length;
  return (
    <span className="avatar-stack" aria-hidden="true">
      {shown.map((p) => (
        <Avatar key={p.id} person={p} size={size} />
      ))}
      {extra > 0 && (
        <span className="avatar-more" style={{ width: size, height: size }}>
          +{extra}
        </span>
      )}
    </span>
  );
}
export function Diff({ before, after }: { before: string; after: string }) {
  const oldLines = before.split('\n'),
    newLines = after.split('\n');
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines.at(-1 - suffix) === newLines.at(-1 - suffix)
  )
    suffix++;
  const lines = [
    ...oldLines.slice(0, prefix).map((text) => ({ text, kind: 'same' })),
    ...oldLines.slice(prefix, oldLines.length - suffix).map((text) => ({ text, kind: 'removed' })),
    ...newLines.slice(prefix, newLines.length - suffix).map((text) => ({ text, kind: 'added' })),
    ...oldLines.slice(oldLines.length - suffix).map((text) => ({ text, kind: 'same' })),
  ];
  return (
    <pre className="exact-diff">
      {lines.map((line, i) => (
        <span className={line.kind} key={i}>
          {line.kind === 'removed' ? '−' : line.kind === 'added' ? '+' : ' '} {line.text}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}
export function Modal({
  title,
  onClose,
  wide = false,
  children,
}: {
  title: string;
  onClose: () => void;
  /** Room for code, traces and diffs. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')?.focus();
  }, [title]);
  return (
    <dialog
      ref={ref}
      className={wide ? 'wide' : undefined}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target !== ref.current) return;
        const bounds = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < bounds.left ||
          e.clientX > bounds.right ||
          e.clientY < bounds.top ||
          e.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      <div className="modal-title">
        <h2 id={titleId}>{title}</h2>
        <button autoFocus className="icon-button" onClick={onClose} aria-label="Close dialog">
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

/** A delete that asks once more in place, so one stray click cannot remove anything. */
export function ConfirmButton({
  label,
  prompt,
  confirmLabel = 'Delete',
  ariaLabel,
  disabled,
  onConfirm,
}: {
  label: React.ReactNode;
  /** The question, read out with the two answers. */
  prompt: string;
  confirmLabel?: string;
  ariaLabel?: string;
  disabled?: boolean;
  onConfirm: () => Promise<void> | void;
}) {
  const [asking, setAsking] = useState(false);
  const start = useRef<HTMLButtonElement>(null),
    confirm = useRef<HTMLButtonElement>(null),
    asked = useRef(false);
  useEffect(() => {
    if (asking) confirm.current?.focus();
    else if (asked.current) start.current?.focus();
    asked.current = asking;
  }, [asking]);
  if (!asking)
    return (
      <button
        ref={start}
        type="button"
        className="text-button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setAsking(true)}
      >
        {label}
      </button>
    );
  return (
    <span className="confirm-inline" role="group" aria-label={prompt}>
      <span>{prompt}</span>
      <button
        ref={confirm}
        type="button"
        className="text-button danger"
        disabled={disabled}
        onClick={async () => {
          try {
            await onConfirm();
          } finally {
            setAsking(false);
          }
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="text-button" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}

export interface MenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}
/** A button that opens a short list of actions. Arrow keys move, Escape or a click away closes. */
export function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId(),
    root = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  const enabled = () => [
    ...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
      []),
  ];
  useEffect(() => {
    if (!open) return;
    enabled()[0]?.focus();
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  return (
    <div
      className="menu"
      ref={root}
      onBlur={(e) => {
        if (open && !root.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (!open) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          button.current?.focus();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const list = enabled(),
            at = list.indexOf(document.activeElement as HTMLButtonElement);
          list[(at + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="icon-button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu-list" role="menu" id={listId} aria-label={label}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? 'danger' : undefined}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                // A dialog this opens returns focus to the menu button when it closes.
                button.current?.focus();
                item.onSelect();
              }}
            >
              {item.icon && <Icon name={item.icon} size={16} />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const HIDDEN_NOTES = 'tinkerfleet.hidden-notes.v1';
function hiddenNotes(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(HIDDEN_NOTES) ?? '[]');
    return Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
/**
 * An explanation of how something works. Read it once, then fold it away; this browser remembers.
 * Safety warnings never use this: they always show.
 */
export function Note({
  id,
  className = 'panel-note',
  children,
}: {
  id: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [hidden, setHidden] = useState(() => hiddenNotes().includes(id));
  const toggle = useRef<HTMLButtonElement>(null),
    toggled = useRef(false);
  useEffect(() => {
    if (toggled.current) toggle.current?.focus();
    toggled.current = false;
  }, [hidden]);
  function set(next: boolean) {
    toggled.current = true;
    setHidden(next);
    try {
      const rest = hiddenNotes().filter((n) => n !== id);
      localStorage.setItem(HIDDEN_NOTES, JSON.stringify(next ? [...rest, id] : rest));
    } catch {}
  }
  if (hidden)
    return (
      <button ref={toggle} type="button" className="note-show" onClick={() => set(false)}>
        <Icon name="info" size={14} />
        How this works
      </button>
    );
  return (
    <div className={`note ${className}`}>
      <div>{children}</div>
      <button
        ref={toggle}
        type="button"
        className="note-hide"
        aria-label="Hide this explanation"
        onClick={() => set(true)}
      >
        Hide
      </button>
    </div>
  );
}
