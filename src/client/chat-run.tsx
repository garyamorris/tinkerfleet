/** One task in a conversation: its messages, any pending approval, live activity, and status. */
import React from 'react';
import type { AgentId, Approval, Conversation, Persona, Run } from '../shared/types';
import { ApprovalCard } from './approval-card';
import { MessageSources, MessageText } from './citations';
import { agentLabel, character, resolveAgent, starterProfiles } from './profiles';
import { RunActivity } from './run-activity';
import { Avatar, Icon, statusText } from './ui';

export function ChatRun({
  run: r,
  chat,
  conversations,
  profiles,
  workspaceRoot,
  busy,
  creating,
  onDecide,
  onOpenBot,
  onChooseChat,
  onShowDetails,
}: {
  run: Run;
  chat: Conversation;
  conversations: Conversation[];
  profiles: Persona[];
  workspaceRoot: string;
  busy: boolean;
  creating: boolean;
  onDecide: (run: Run, approval: Approval, approved: boolean) => Promise<void>;
  onOpenBot: (bot: Persona, conversationId?: string) => void;
  onChooseChat: (id: string) => void;
  onShowDetails: (runId: string, tab: 'Activity' | 'Changes') => void;
}) {
  const participants = r.team ?? chat.participants,
    getPerson = (id: AgentId) =>
      resolveAgent(
        id,
        participants,
        conversations.find((c) => c.id === chat.startedBy?.conversationId)?.participants ?? [],
        profiles,
        starterProfiles,
      ),
    pending = r.approvals.find((a) => a.status === 'pending');
  return (
    <section className="chat-run" aria-label={`Task: ${r.prompt}`}>
      <div className="thread-heading">
        <span>
          {new Date(r.startedAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}{' '}
          · {r.mode === 'demo' ? 'Scripted demo · ' : ''}
          {statusText[r.status]}
        </span>
        <button
          className="text-button"
          onClick={() => {
            onShowDetails(r.id, 'Activity');
          }}
        >
          Task details
          <Icon name="chevron" size={13} />
        </button>
      </div>
      {r.messages.map((m) => (
        <article key={m.id} className={`message ${m.author === 'user' ? 'outgoing' : ''}`}>
          {m.author !== 'user' && <Avatar person={character(getPerson(m.author))} size={32} />}
          <div className="message-content">
            {m.author !== 'user' && (
              <div className="message-byline">
                {getPerson(m.author).name}
                <span>{agentLabel(getPerson(m.author))}</span>
              </div>
            )}
            <div className={`bubble ${m.kind === 'result' ? 'result' : ''}`}>
              {m.author !== 'user' ? (
                <MessageText text={m.text} sources={r.mode === 'live' ? m.sources : undefined} />
              ) : (
                m.text
              )}
            </div>
            {m.author !== 'user' && r.mode === 'live' && <MessageSources sources={m.sources} />}
            <>
              {m.createdAgentId && (
                <button
                  className="group-link"
                  disabled={creating || !profiles.some((p) => p.id === m.createdAgentId)}
                  onClick={() => {
                    const bot = profiles.find((p) => p.id === m.createdAgentId);
                    if (bot) onOpenBot(bot, m.conversationId);
                  }}
                >
                  <Icon name="team" size={18} />
                  <span>
                    <strong>
                      Created {profiles.find((p) => p.id === m.createdAgentId)?.name ?? 'a bot'}
                    </strong>
                    <small>Open this bot’s chat</small>
                  </span>
                  <Icon name="chevron" size={16} />
                </button>
              )}
              {m.conversationId && !m.createdAgentId && (
                <button
                  className="group-link"
                  disabled={!conversations.some((c) => c.id === m.conversationId)}
                  onClick={() => onChooseChat(m.conversationId!)}
                >
                  <Icon name="team" size={18} />
                  <span>
                    <strong>
                      {conversations.find((c) => c.id === m.conversationId)?.title ??
                        'Agent conversation'}
                    </strong>
                    <small>Open conversation</small>
                  </span>
                  <Icon name="chevron" size={16} />
                </button>
              )}
            </>
          </div>
        </article>
      ))}
      {pending && (
        <ApprovalCard
          a={pending}
          mode={r.mode}
          workspaceRoot={workspaceRoot}
          busy={busy}
          agentName={getPerson(pending.agent).name}
          onDecide={(a, approved) => onDecide(r, a, approved)}
        />
      )}
      <RunActivity run={r} nameFor={(id) => getPerson(id).name} />
      <div className="run-status">
        {r.status === 'completed' ? (
          <>
            <Icon name="check" size={16} />
            Complete
            <button
              className="text-button"
              onClick={() => {
                onShowDetails(r.id, 'Changes');
              }}
            >
              Review results
              <Icon name="chevron" size={14} />
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}
