/** The sidebar: the primary agent, every conversation with its latest state, and the bot library. */
import React from 'react';
import type { Conversation, Persona, Run } from '../shared/types';
import { character } from './profiles';
import { Avatar, Icon, statusText } from './ui';

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
  return (
    <>
      <button className="primary-access" onClick={onTalkToPrimary}>
        <Avatar person={character(primary)} size={35} />
        <span>
          <strong>{primary.name}</strong>
          <small>Primary agent</small>
        </span>
        <Icon name="chevron" size={15} />
      </button>
      <div className="sidebar-top">
        <h2>Conversations</h2>
        <button className="icon-button" aria-label="Talk to a bot" onClick={onNew}>
          <Icon name="plus" />
        </button>
      </div>
      <nav className="chat-list" aria-label="Conversations">
        {[...conversations]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((c) => {
            const runs = allRuns.filter((r) => r.conversationId === c.id),
              latest = runs.at(-1),
              running = runs.find((r) => ['running', 'awaiting_approval'].includes(r.status)),
              text = draftFor(c),
              meta = `${
                c.startedBy
                  ? `Started by ${startedByName(c)}`
                  : c.participants.length === 1
                    ? c.participants[0].name
                    : `${c.participants.length} bots`
              } · ${
                running
                  ? statusText[running.status]
                  : latest
                    ? statusText[latest.status]
                    : 'New chat'
              }`;
            return (
              <button
                key={c.id}
                className={activeChatId === c.id ? 'selected' : ''}
                aria-current={activeChatId === c.id ? 'page' : undefined}
                // The preview can be a whole reply; a screen reader gets the title and state.
                aria-label={`${c.title}, ${meta}`}
                onClick={() => onChoose(c.id)}
              >
                <span className="chat-row-avatars" aria-hidden="true">
                  {c.participants.map((p) => (
                    <Avatar key={p.id} person={character(p)} size={23} />
                  ))}
                </span>
                <span className="chat-row-title">
                  {c.title}
                  {running && (
                    <i
                      className={
                        running.status === 'awaiting_approval' ? 'needs-review' : 'working-dot'
                      }
                    />
                  )}
                </span>
                <span className="chat-preview">
                  {text
                    ? `Draft: ${text}`
                    : (latest?.messages.at(-1)?.text ??
                      c.participants.map((p) => p.name).join(', '))}
                </span>
                <span className="chat-row-meta">{meta}</span>
              </button>
            );
          })}
        {!conversations.length && (
          <p className="sidebar-empty">
            Start with your primary agent. Agent conversations will appear here.
          </p>
        )}
      </nav>
      <button className="sidebar-library" onClick={onOpenLibrary}>
        <Icon name="team" size={17} />
        Bot library<span>{botCount}</span>
      </button>
    </>
  );
}
