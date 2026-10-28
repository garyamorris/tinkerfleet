/** The sidebar: the primary agent, every conversation with its latest state, and the bot library. */
import React, { useState } from 'react';
import type { Conversation, Persona, Run } from '../shared/types';
import { character } from './profiles';
import { Avatar, AvatarStack, Icon, statusText } from './ui';

/** Past this many chats, a search box appears above the list. */
const SEARCH_FROM = 7;

export function ChatList({
  primary,
  conversations,
  allRuns,
  activeChatId,
  botCount,
  draftFor,
  startedByName,
  onTalkToPrimary,
  onNew,
  onChoose,
  onOpenLibrary,
}: {
  primary: Persona;
  conversations: Conversation[];
  allRuns: Run[];
  activeChatId?: string;
  botCount: number;
  draftFor: (c: Conversation) => string;
  startedByName: (c: Conversation) => string;
  onTalkToPrimary: () => void;
  onNew: () => void;
  onChoose: (id: string) => void;
  onOpenLibrary: () => void;
}) {
  const [query, setQuery] = useState('');
  const rows = [...conversations]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => {
      const runs = allRuns.filter((r) => r.conversationId === c.id),
        latest = runs.at(-1),
        running = runs.find((r) => ['running', 'awaiting_approval'].includes(r.status)),
        draft = draftFor(c),
        preview = draft ? `Draft: ${draft}` : (latest?.messages.at(-1)?.text ?? ''),
        status = running?.status ?? latest?.status;
      return { c, running, preview, status };
    });
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? rows.filter(({ c, preview }) =>
        [c.title, preview, ...c.participants.map((p) => p.name)].some((text) =>
          text.toLowerCase().includes(needle),
        ),
      )
    : rows;
  return (
    <>
      <button className="primary-access" onClick={onTalkToPrimary}>
        <Avatar person={character(primary)} size={34} />
        <span>
          <strong>{primary.name}</strong>
          <small>Primary bot</small>
        </span>
        <Icon name="chevron" size={15} />
      </button>
      <div className="sidebar-top">
        <h2>Conversations</h2>
        <button
          className="icon-button"
          aria-label="Talk to a bot"
          title="Talk to a bot"
          onClick={onNew}
        >
          <Icon name="plus" />
        </button>
      </div>
      {conversations.length >= SEARCH_FROM && (
        <label className="chat-search">
          <Icon name="search" size={15} />
          <input
            type="search"
            value={query}
            placeholder="Search chats"
            aria-label="Search conversations"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}
      <nav className="chat-list" aria-label="Conversations">
        {shown.map(({ c, running, preview, status }) => {
          const who = c.startedBy
            ? `group started by ${startedByName(c)}`
            : c.participants.map((p) => p.name).join(', ');
          return (
            <button
              key={c.id}
              className={`chat-row${activeChatId === c.id ? ' selected' : ''}`}
              aria-current={activeChatId === c.id ? 'page' : undefined}
              // The preview can be a whole reply; a screen reader gets the title, who, and state.
              aria-label={`${c.title}, ${who}, ${status ? statusText[status] : 'new chat'}`}
              onClick={() => onChoose(c.id)}
            >
              <AvatarStack people={c.participants.map(character)} size={24} max={2} />
              <span className="chat-row-main" aria-hidden="true">
                <span className="chat-row-top">
                  <span className="chat-row-title">{c.title}</span>
                  {running?.status === 'awaiting_approval' ? (
                    <span className="badge warning">Needs you</span>
                  ) : running ? (
                    <i className="working-dot" />
                  ) : status === 'failed' ? (
                    <span className="badge danger">Failed</span>
                  ) : null}
                </span>
                {preview && <span className="chat-preview">{preview}</span>}
              </span>
            </button>
          );
        })}
        {!conversations.length && (
          <p className="sidebar-empty">
            Start with your primary bot. Your conversations will appear here.
          </p>
        )}
        {conversations.length > 0 && !shown.length && (
          <p className="sidebar-empty">No chats match “{query.trim()}”.</p>
        )}
      </nav>
      <button className="sidebar-library" onClick={onOpenLibrary}>
        <Icon name="team" size={17} />
        Bot library<span>{botCount}</span>
      </button>
    </>
  );
}
