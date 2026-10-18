/** Small shared UI pieces: icons, avatars, diffs, the modal dialog, and run status labels. */
import React, { useEffect, useId, useRef } from 'react';
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
  children,
}: {
  title: string;
  onClose: () => void;
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
