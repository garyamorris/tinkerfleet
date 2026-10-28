/** One task in a conversation: its messages, your decisions, any pending approval, and status. */
import React from 'react';
import type { AgentId, Approval, Capability, Conversation, Persona, Run } from '../shared/types';
import type { ServerCapabilities } from '../shared/capabilities';
import { ApprovalCard } from './approval-card';
import { CreatedBotCapabilities } from './bot-dialogs';
import { MessageSources, MessageText } from './citations';
import { agentLabel, character, resolveAgent, starterProfiles } from './profiles';
import { RunActivity } from './run-activity';
import { Avatar, Icon, commandLine, runOutcome } from './ui';

export type DetailsTab = 'Activity' | 'Trace' | 'Output' | 'Changes';

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Your answer to an approval stays in the thread, so the record shows who decided what. */
function Decision({ a, onView }: { a: Approval; onView: (tab: DetailsTab) => void }) {
  const approved = a.status === 'approved';
  return (
    <div className={`decision ${approved ? 'approved' : 'declined'}`}>
      <Icon name={approved ? 'check' : 'close'} size={15} />
      <span>
        <strong>{approved ? 'Approved' : 'Declined'}</strong>{' '}
        {a.action.kind === 'edit' ? (
          <>
            the edit to <code>{a.action.path}</code>
          </>
        ) : (
          <>
            the command <code>{commandLine(a.action.executable, a.action.args)}</code>
          </>
        )}
        {a.decidedAt !== undefined && (
          <span className="decision-time"> · {clock(a.decidedAt)}</span>
        )}
      </span>
      {approved && (
        <button
          className="text-button"
          onClick={() => onView(a.action.kind === 'edit' ? 'Changes' : 'Output')}
        >
          {a.action.kind === 'edit' ? 'View change' : 'View output'}
        </button>
      )}
    </div>
  );
}

/** Where a linked conversation's work stands, for the card that opens it. */
function linkedStatus(runs: Run[]): { label: string; tone: string } | null {
  const run = runs.at(-1);
  if (!run) return null;
  if (run.status === 'awaiting_approval') return { label: 'Waiting for you', tone: 'warning' };
  if (run.status === 'running') return { label: 'Working', tone: 'neutral' };
  return runOutcome(run);
}

export function ChatRun({
  run: r,
  chat,
  conversations,
  allRuns,
  profiles,
  workspaceRoot,
  busy,
  creating,
  server,
  onDecide,
  onGrant,
  onOpenBot,
  onChooseChat,
  onShowDetails,
}: {
  run: Run;
  chat: Conversation;
  conversations: Conversation[];
  allRuns: Run[];
  profiles: Persona[];
  workspaceRoot: string;
  busy: boolean;
  creating: boolean;
  server: ServerCapabilities;
  onDecide: (run: Run, approval: Approval, approved: boolean) => Promise<void>;
  onGrant: (bot: Persona, capabilities: Capability[]) => Promise<void>;
  onOpenBot: (bot: Persona, conversationId?: string) => void;
  onChooseChat: (id: string) => void;
  onShowDetails: (runId: string, tab: DetailsTab) => void;
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
    pending = r.approvals.find((a) => a.status === 'pending'),
    finished = !['running', 'awaiting_approval'].includes(r.status),
    outcome = runOutcome(r);
  // Messages and decisions in the order they happened. Older saved decisions have no time.
  const items = [
    ...r.messages.map((m) => ({ at: m.at, key: m.id, message: m })),
    ...r.approvals
      .filter((a) => a.status !== 'pending')
      .map((a) => ({ at: a.decidedAt ?? Infinity, key: a.id, decision: a })),
  ].sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? -1 : 1));
  return (
    <section className="chat-run" aria-label={`Task: ${r.prompt}`}>
      <div className="thread-heading">{clock(r.startedAt)}</div>
      {items.map((item) => {
        if ('decision' in item)
          return (
            <Decision key={item.key} a={item.decision} onView={(tab) => onShowDetails(r.id, tab)} />
          );
        const m = item.message;
        const author = m.author === 'user' ? null : getPerson(m.author);
        const linked = m.conversationId
          ? linkedStatus(
              allRuns.filter(
                (x) =>
                  x.conversationId === m.conversationId && (!x.sentBy || x.sentBy.runId === r.id),
              ),
            )
          : null;
        return (
          <article
            key={m.id}
            className={`message ${author ? 'incoming' : 'outgoing'}`}
            style={author ? ({ '--agent-color': author.color } as React.CSSProperties) : undefined}
          >
            {author && <Avatar person={character(author)} size={32} />}
            <div className="message-content">
              {!author && r.scheduleId && m.id === r.messages[0]?.id && (
                <div className="message-byline scheduled-marker" title="Sent by a schedule">
                  <Icon name="clock" size={13} />
                  Scheduled
                </div>
              )}
              {author && (
                <div className="message-byline">
                  {author.name}
                  {agentLabel(author) && <span className="byline-badge">{agentLabel(author)}</span>}
                </div>
              )}
              <div className={`bubble${m.kind === 'delegation' ? ' brief' : ''}`}>
                {author ? (
                  <MessageText text={m.text} sources={r.mode === 'live' ? m.sources : undefined} />
                ) : (
                  m.text
                )}
              </div>
              {author && r.mode === 'live' && <MessageSources sources={m.sources} />}
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
              {m.createdAgentId && profiles.some((p) => p.id === m.createdAgentId) && (
                <CreatedBotCapabilities
                  bot={profiles.find((p) => p.id === m.createdAgentId)!}
                  requested={m.requestedCapabilities ?? []}
                  server={server}
                  onGrant={onGrant}
                />
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
                        'Deleted conversation'}
                    </strong>
                    <small>Open conversation</small>
                  </span>
                  {linked && <span className={`badge ${linked.tone}`}>{linked.label}</span>}
                  <Icon name="chevron" size={16} />
                </button>
              )}
            </div>
          </article>
        );
      })}
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
      {/* One row per task: how it ended, its steps, and one way into Task details. */}
      <div className="run-footer">
        {finished && (
          <span className={`run-state ${outcome.tone}`}>
            {outcome.tone === 'success' && <Icon name="check" size={15} />}
            {outcome.label}
          </span>
        )}
        <RunActivity run={r} nameFor={(id) => getPerson(id).name} />
        <button
          className="text-button run-details"
          onClick={() => onShowDetails(r.id, r.artifacts.length ? 'Changes' : 'Activity')}
        >
          Task details
          <Icon name="chevron" size={13} />
        </button>
      </div>
    </section>
  );
}
