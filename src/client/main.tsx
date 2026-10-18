/**
 * The browser app. App owns the state (polled from the local server every 700 ms),
 * the draft and conversation handlers, and the layout; panels and dialogs live in
 * their own files and receive what they show as props.
 */
import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppState, Run, Approval, AgentId, Persona, Conversation } from '../shared/types';
import './style.css';
import { randomAppearance } from '../shared/appearance';
import { api, setCsrf } from './api';
import { BotLibraryDialog, PersonaEditorDialog } from './bot-dialogs';
import { directBotChat } from './bot-chat';
import { ChatList } from './chat-list';
import { ChatRun } from './chat-run';
import { NewConversationDialog, RenameDialog } from './conversation-dialogs';
import { loadDrafts, type ChatDraft } from './drafts';
import { MemoryPanel } from './memory-panel';
import { character, loadLibrary, resolveAgent, starterProfiles, validProfile } from './profiles';
import { SettingsDialog } from './settings-dialog';
import { TaskDetailsDialog } from './task-details-dialog';
import { Avatar, Icon, Modal, statusText } from './ui';

function App() {
  const [state, setState] = useState<AppState | null>(null),
    [legacyLibrary] = useState(loadLibrary),
    [chatId, setChatId] = useState<string | null>(() => {
      try {
        return localStorage.getItem('tinkerfleet.active-chat');
      } catch {
        return null;
      }
    }),
    [runId, setRunId] = useState<string | null>(null),
    [busyChats, setBusyChats] = useState<string[]>([]),
    [creating, setCreating] = useState(false),
    [savingProfile, setSavingProfile] = useState(false),
    [libraryImportError, setLibraryImportError] = useState(''),
    [chatErrors, setChatErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState(''),
    [modal, setModal] = useState<
      'team' | 'edit' | 'new' | 'rename' | 'chats' | 'details' | 'settings' | 'memory' | null
    >(null),
    [tab, setTab] = useState('Activity'),
    [draft, setDraft] = useState<Persona>(starterProfiles[0]),
    [formError, setFormError] = useState(''),
    [chosen, setChosen] = useState<string[]>([]),
    [chatTitle, setChatTitle] = useState(''),
    [, redrawDrafts] = useState(0);
  const [memoryBot, setMemoryBot] = useState<Persona | null>(null);
  const openingBot = useRef(false);
  const end = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null);
  const drafts = useRef<Record<string, ChatDraft>>(loadDrafts());
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({}),
    saveQueues = useRef<Record<string, Promise<void>>>({});
  const library = {
    profiles: state?.profiles ?? legacyLibrary.profiles,
    assignments: legacyLibrary.assignments,
  };
  const primary =
    library.profiles.find(
      (p) => p.id === library.assignments.coordinator && p.role === 'coordinator',
    ) ??
    library.profiles.find((p) => p.role === 'coordinator') ??
    starterProfiles[0];
  const team = [primary, ...library.profiles.filter((p) => p.id !== primary.id)];
  const conversations = state?.conversations ?? [];
  const chat =
    conversations.find((c) => c.id === chatId) ??
    [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  useEffect(() => {
    if (chat && chat.id !== chatId) {
      setChatId(chat.id);
      try {
        localStorage.setItem('tinkerfleet.active-chat', chat.id);
      } catch {}
    }
  }, [chat?.id, chatId]);
  const chatRuns = (state?.runs ?? [])
    .filter((r) => r.conversationId === chat?.id)
    .sort((a, b) => a.startedAt - b.startedAt);
  const run = chatRuns.find((r) => r.id === runId) ?? chatRuns.at(-1);
  const runTeam = run?.team ?? chat?.participants ?? team;
  const person = (id: AgentId) =>
    resolveAgent(
      id,
      runTeam,
      conversations.find((c) => c.id === chat?.startedBy?.conversationId)?.participants ?? [],
      library.profiles,
      starterProfiles,
    );
  const currentActive = chatRuns.find((r) => ['running', 'awaiting_approval'].includes(r.status));
  const busy = !!chat && busyChats.includes(chat.id);
  const prompt = chat ? (drafts.current[chat.id]?.text ?? chat.draft) : '';
  function cacheDrafts() {
    try {
      localStorage.setItem('tinkerfleet.chat-drafts.v1', JSON.stringify(drafts.current));
    } catch {
      setError('This browser could not cache your draft. Server saving is still being attempted.');
    }
  }
  function saveDraft(id: string): Promise<void> {
    clearTimeout(saveTimers.current[id]);
    const queued = (saveQueues.current[id] ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const entry = drafts.current[id];
        if (!entry?.dirty) return;
        const { text, version } = entry;
        await api(`/conversations/${id}`, { draft: text });
        if (drafts.current[id]?.version === version) {
          drafts.current[id].dirty = false;
          cacheDrafts();
        }
      });
    saveQueues.current[id] = queued;
    return queued;
  }
  function updatePrompt(id: string, text: string) {
    const old = drafts.current[id];
    drafts.current[id] = { text, version: (old?.version ?? 0) + 1, dirty: true };
    cacheDrafts();
    redrawDrafts((n) => n + 1);
    clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(() => {
      void saveDraft(id).catch((e) =>
        setChatErrors((errors) => ({
          ...errors,
          [id]: `Draft could not sync: ${(e as Error).message}. Your draft is retained locally; retry by editing or sending it.`,
        })),
      );
    }, 400);
  }
  function chooseChat(id: string) {
    setError('');
    setFormError('');
    setChatId(id);
    setRunId(null);
    setModal(null);
    try {
      localStorage.setItem('tinkerfleet.active-chat', id);
    } catch {}
  }
  function openNew(profile: Persona = team[0]) {
    setChosen([profile.id]);
    setChatTitle('');
    setFormError('');
    setModal('new');
  }
  async function openBot(bot: Persona, conversationId?: string) {
    if (openingBot.current) return;
    openingBot.current = true;
    setCreating(true);
    setFormError('');
    try {
      const target =
        conversationId ??
        (
          await directBotChat(bot, conversations, library.profiles, (body) =>
            api<Conversation>('/conversations', body),
          )
        ).id;
      setState(await api<AppState>('/state'));
      chooseChat(target);
    } catch (e) {
      setFormError((e as Error).message);
      setError((e as Error).message);
    } finally {
      openingBot.current = false;
      setCreating(false);
    }
  }
  function openMemory(bot: Persona) {
    setMemoryBot(bot);
    setModal('memory');
  }
  function markBusy(id: string, on: boolean) {
    setBusyChats((ids) => (on ? [...new Set([...ids, id])] : ids.filter((x) => x !== id)));
  }
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval>;
    async function refresh() {
      try {
        const data = await api<AppState>('/state');
        if (alive) setState(data);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    }
    void (async () => {
      try {
        const session = await api<{ csrf: string }>('/session');
        setCsrf(session.csrf);
        const initial = await api<AppState>('/state');
        let shouldImport = !initial.profiles?.length;
        try {
          shouldImport =
            shouldImport || localStorage.getItem('tinkerfleet.profiles-imported.v1') !== 'true';
        } catch {}
        if (shouldImport) {
          try {
            await api<Persona[]>('/profiles/import', { profiles: legacyLibrary.profiles });
            try {
              localStorage.setItem('tinkerfleet.profiles-imported.v1', 'true');
            } catch {}
          } catch (e) {
            if (alive) {
              const message = `Your browser bots could not be imported: ${(e as Error).message}. Bot library contains a read-only backup you can export; no bots were discarded.`;
              setLibraryImportError(message);
              setError(message);
            }
          }
        }
        await refresh();
        if (alive) {
          timer = setInterval(refresh, 700);
          for (const id of Object.keys(drafts.current)) {
            if (drafts.current[id]?.dirty) void saveDraft(id).catch(() => {});
          }
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
      clearInterval(timer);
      Object.values(saveTimers.current).forEach(clearTimeout);
    };
  }, []);
  const last = chatRuns.at(-1);
  useEffect(() => {
    end.current?.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'end',
    });
  }, [chat?.id, last?.id, last?.messages.length, last?.approvals.length]);
  async function createChat() {
    if (creating || !chosen.length) return;
    setCreating(true);
    setFormError('');
    try {
      const participants = chosen
        .slice(0, 1)
        .map((id) => library.profiles.find((p) => p.id === id)!)
        .filter(Boolean);
      if (!participants.length) throw new Error('Choose a bot to talk with.');
      const result = await api<Conversation>('/conversations', {
        title:
          chatTitle.trim() ||
          participants
            .map((p) => p.name)
            .join(' + ')
            .slice(0, 80),
        participants,
        ...(participants[0].role === 'coordinator'
          ? { availableBots: library.profiles.filter((p) => p.role !== 'coordinator') }
          : {}),
      });
      setState(await api<AppState>('/state'));
      chooseChat(result.id);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }
  async function renameChat() {
    if (!chat || !chatTitle.trim() || creating) return;
    const id = chat.id;
    setCreating(true);
    try {
      await api(`/conversations/${id}`, { title: chatTitle.trim() });
      setState(await api<AppState>('/state'));
      setModal(null);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }
  async function start(text: string) {
    if (!chat || busy || currentActive || !state || !text.trim()) return;
    const id = chat.id,
      version = drafts.current[id]?.version ?? 0;
    markBusy(id, true);
    setChatErrors((errors) => ({ ...errors, [id]: '' }));
    try {
      await saveDraft(id);
      if (
        chat.participants.length === 1 &&
        chat.participants[0].role === 'coordinator' &&
        chat.availableBots === undefined
      ) {
        await api(`/conversations/${id}`, {
          availableBots: library.profiles.filter((p) => p.role !== 'coordinator'),
        });
      }
      await api<Run>(`/conversations/${id}/runs`, { prompt: text.trim() });
      if ((drafts.current[id]?.version ?? 0) === version) {
        drafts.current[id] = { text: '', version: version + 1, dirty: false };
        cacheDrafts();
        redrawDrafts((n) => n + 1);
      }
      setState(await api<AppState>('/state'));
      setTab('Activity');
    } catch (e) {
      setChatErrors((errors) => ({ ...errors, [id]: (e as Error).message }));
    } finally {
      markBusy(id, false);
    }
  }
  async function decide(target: Run, a: Approval, approved: boolean) {
    const id = target.conversationId;
    if (!id || busyChats.includes(id)) return;
    markBusy(id, true);
    setChatErrors((errors) => ({ ...errors, [id]: '' }));
    try {
      await api(`/conversations/${id}/runs/${target.id}/approval`, {
        approvalId: a.id,
        digest: a.digest,
        approved,
      });
      setState(await api<AppState>('/state'));
    } catch (e) {
      setChatErrors((errors) => ({ ...errors, [id]: (e as Error).message }));
    } finally {
      markBusy(id, false);
    }
  }
  async function stop() {
    if (!chat || !currentActive || busy) return;
    const id = chat.id,
      target = currentActive.id;
    markBusy(id, true);
    try {
      await api(`/conversations/${id}/runs/${target}/stop`, {});
      setState(await api<AppState>('/state'));
    } catch (e) {
      setChatErrors((errors) => ({ ...errors, [id]: (e as Error).message }));
    } finally {
      markBusy(id, false);
    }
  }
  async function saveProfile() {
    if (savingProfile) return;
    setFormError('');
    if (
      library.profiles.some((p) => p.id === draft.id && p.role === 'coordinator') &&
      draft.role !== 'coordinator'
    ) {
      setFormError(
        'The primary agent stays primary. You can change its personality, name, and appearance.',
      );
      return;
    }
    const saved: Persona = {
      ...draft,
      role: library.profiles.some((p) => p.id === draft.id && p.role === 'coordinator')
        ? 'coordinator'
        : 'agent',
      name: draft.name.trim(),
      purpose: draft.purpose.trim(),
    };
    if (!validProfile(saved)) {
      setFormError('Add a name (up to 40 characters) and purpose (up to 600 characters).');
      return;
    }
    if (
      /[\x00-\x1f\x7f]/.test(saved.name) ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(saved.purpose)
    ) {
      setFormError('Remove unsupported control characters from this profile.');
      return;
    }
    setSavingProfile(true);
    try {
      const { id, ...fields } = saved;
      const editing = library.profiles.some((p) => p.id === id);
      const result = await api<Persona>(editing ? `/profiles/${id}` : '/profiles', fields);
      setState(await api<AppState>('/state'));
      setModal('team');
      if (!editing) await openBot(result);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSavingProfile(false);
    }
  }

  const orderedProfiles = [...library.profiles].sort(
    (a, b) =>
      Number(b.id === team[0].id) - Number(a.id === team[0].id) ||
      Number(b.role === 'coordinator') - Number(a.role === 'coordinator'),
  );
  function startedByName(c: Conversation) {
    return (
      conversations
        .find((source) => source.id === c.startedBy?.conversationId)
        ?.participants.find((p) => p.id === c.startedBy?.coordinatorId)?.name ??
      c.participants.find((p) => p.id === c.startedBy?.coordinatorId)?.name ??
      'the primary agent'
    );
  }
  function talkToPrimary() {
    const existing = [...conversations]
      .filter((c) => c.participants.length === 1 && c.participants[0].id === team[0].id)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (existing) chooseChat(existing.id);
    else openNew(team[0]);
  }
  const visibleError = error || (chat && chatErrors[chat.id]) || '';
  const chatList = (
    <ChatList
      primary={team[0]}
      conversations={conversations}
      allRuns={state?.runs ?? []}
      activeChatId={chat?.id}
      botCount={library.profiles.length}
      draftFor={(c) => drafts.current[c.id]?.text ?? c.draft}
      startedByName={startedByName}
      onTalkToPrimary={talkToPrimary}
      onNew={() => openNew()}
      onChoose={chooseChat}
      onOpenLibrary={() => setModal('team')}
    />
  );
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            tinkerfleet<span className="brand-dot">.</span>
          </span>
        </div>
        <nav aria-label="Workspace">
          <button className="mobile-chats" onClick={() => setModal('chats')}>
            <Icon name="layers" size={18} />
            <span>Chats</span>
          </button>
          <button onClick={() => setModal('team')}>
            <Icon name="team" size={18} />
            <span>Bots</span>
          </button>
          <button
            disabled={!chat}
            onClick={() => {
              setRunId(null);
              setModal('details');
            }}
          >
            <Icon name="activity" size={18} />
            <span>Details</span>
          </button>
        </nav>
      </header>
      <div className="workspace-layout">
        <aside className="chat-sidebar">{chatList}</aside>
        <main className="conversation">
          {chat && (
            <header className="chat-heading">
              <div className="chat-participants">
                {chat.participants.map((p) => (
                  <Avatar key={p.id} person={character(p)} size={30} />
                ))}
              </div>
              <div>
                <h1>{chat.title}</h1>
                <p>{chat.participants.map((p) => p.name).join(' · ')}</p>
              </div>
              <button
                className="icon-button"
                aria-label="Rename conversation"
                title="Rename conversation"
                onClick={() => {
                  setChatTitle(chat.title);
                  setFormError('');
                  setModal('rename');
                }}
              >
                <Icon name="settings" size={17} />
              </button>
            </header>
          )}
          {chat?.startedBy && (
            <div className="group-provenance">
              <span>Started by {startedByName(chat)}</span>
              <button
                className="text-button"
                onClick={() => chooseChat(chat.startedBy!.conversationId)}
              >
                Original conversation
                <Icon name="chevron" size={13} />
              </button>
            </div>
          )}
          <div className="workspace-bar">
            <button className="mode-label" onClick={() => setModal('settings')}>
              <span className={`mode-dot ${state?.mode === 'live' ? 'live' : ''}`} />
              {state?.mode === 'live' ? 'Live chat' : 'Scripted demo'}
              <Icon name="chevron" size={13} />
            </button>
            <span>
              {state?.mode === 'live'
                ? state.workspaceToolsEnabled
                  ? 'Local file tools enabled'
                  : 'No file access or commands'
                : 'No API calls. Tools act on a temporary copy of tiny-project.'}
            </span>
          </div>
          {state?.persistenceError && (
            <div role="alert" className="error-banner">
              History could not be saved: {state.persistenceError}
            </div>
          )}
          {visibleError && (
            <div role="alert" className="error-banner">
              {visibleError}
              <button
                aria-label="Dismiss error"
                onClick={() => {
                  setError('');
                  if (chat) setChatErrors((errors) => ({ ...errors, [chat.id]: '' }));
                }}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          <div className="messages">
            {!chat ? (
              <section className="welcome">
                <div className="welcome-avatars">
                  <Avatar person={character(team[0])} size={76} />
                </div>
                <h1>Start with {team[0].name}.</h1>
                <p>
                  Tell your primary agent what you want to do.
                  <br />
                  They can create individual agents and send them messages.
                </p>
                <button className="primary" onClick={() => openNew()} disabled={!state}>
                  Talk to {team[0].name}
                  <Icon name="arrow" size={17} />
                </button>
                <div>
                  <button className="text-button" onClick={() => setModal('team')}>
                    Create and manage your bots
                  </button>
                </div>
              </section>
            ) : !chatRuns.length ? (
              <section className="welcome chat-welcome">
                <div className="welcome-avatars">
                  {chat.participants.map((p) => (
                    <Avatar key={p.id} person={character(p)} size={64} />
                  ))}
                </div>
                <h1>
                  {chat.participants.length === 1
                    ? `Meet ${chat.participants[0].name}.`
                    : 'A conversation for your team.'}
                </h1>
                <p>
                  {chat.participants.length === 1
                    ? chat.participants[0].role === 'coordinator'
                      ? 'Tell me what you want to work on. I can create an agent with the right personality and send it a message when it can help.'
                      : chat.participants[0].purpose
                    : `${chat.participants.map((p) => p.name).join(', ')} are here. Only these bots take part in this chat.`}
                </p>
                {state?.mode === 'demo' && (
                  <button
                    className="start-card"
                    disabled={!state || busy || !!currentActive}
                    onClick={() => start('Help me fix the failing tests in tiny-project.')}
                  >
                    <Icon name="terminal" size={21} />
                    <span>
                      <strong>Try a demo conversation</strong>
                      <small>A scripted model with real tools and approvals</small>
                    </span>
                    <Icon name="arrow" size={18} />
                  </button>
                )}
              </section>
            ) : (
              <div className="thread">
                {chatRuns.map((r) => (
                  <ChatRun
                    key={r.id}
                    run={r}
                    chat={chat}
                    conversations={conversations}
                    profiles={library.profiles}
                    workspaceRoot={state?.workspaceRoot ?? ''}
                    busy={busyChats.includes(chat.id)}
                    creating={creating}
                    onDecide={decide}
                    onOpenBot={(bot, conversationId) => void openBot(bot, conversationId)}
                    onChooseChat={chooseChat}
                    onShowDetails={(id, nextTab) => {
                      setRunId(id);
                      setTab(nextTab);
                      setModal('details');
                    }}
                  />
                ))}
              </div>
            )}
            <div ref={end} />
          </div>
          {chat && (
            <div className="composer-area">
              {currentActive && (
                <div className="run-control">
                  <span>{statusText[currentActive.status]}</span>
                  <button className="text-button" onClick={stop} disabled={busy}>
                    <Icon name="stop" size={13} />
                    Stop
                  </button>
                </div>
              )}
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  start(prompt);
                }}
              >
                <textarea
                  ref={composer}
                  rows={2}
                  maxLength={8000}
                  aria-label={`Message ${chat.title}`}
                  placeholder={
                    currentActive
                      ? 'Draft your next message…'
                      : `Message ${chat.participants.length === 1 ? chat.participants[0].name : 'this group'}…`
                  }
                  value={prompt}
                  disabled={busy}
                  onChange={(e) => updatePrompt(chat.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      start(prompt);
                    }
                  }}
                />
                <button
                  type="submit"
                  className="send-button"
                  aria-label="Send message"
                  disabled={!state || !prompt.trim() || busy || !!currentActive}
                >
                  <Icon name="arrow" size={20} />
                </button>
              </form>
              <p className="composer-note">
                {state?.mode === 'live'
                  ? 'Live model responses · Only this conversation’s participants receive its context.'
                  : 'Demo replies come from a scripted model. Live chats use your bots’ purposes.'}
              </p>
            </div>
          )}
        </main>
      </div>
      {modal === 'chats' && (
        <Modal title="Your conversations" onClose={() => setModal(null)}>
          {chatList}
        </Modal>
      )}
      {modal === 'new' && (
        <NewConversationDialog
          profiles={orderedProfiles}
          chosen={chosen}
          title={chatTitle}
          error={formError}
          creating={creating}
          onChoose={(id) => setChosen([id])}
          onTitle={setChatTitle}
          onSubmit={createChat}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'rename' && chat && (
        <RenameDialog
          title={chatTitle}
          error={formError}
          creating={creating}
          onTitle={setChatTitle}
          onSubmit={renameChat}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'team' && (
        <BotLibraryDialog
          profiles={orderedProfiles}
          legacyLibrary={legacyLibrary}
          importError={libraryImportError}
          creating={creating}
          onEdit={(p) => {
            setFormError('');
            setDraft({ ...p });
            setModal('edit');
          }}
          onCreate={() => {
            setFormError('');
            setDraft({
              id: crypto.randomUUID(),
              role: 'agent',
              name: '',
              purpose: '',
              ...randomAppearance(),
            });
            setModal('edit');
          }}
          onMemory={openMemory}
          onTalk={(p) => void openBot(p)}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'edit' && (
        <PersonaEditorDialog
          draft={draft}
          isNew={!library.profiles.some((p) => p.id === draft.id)}
          error={formError}
          saving={savingProfile}
          onChange={setDraft}
          onSubmit={saveProfile}
          onCancel={() => setModal('team')}
        />
      )}
      {modal === 'memory' && memoryBot && (
        <Modal title={`${memoryBot.name}’s memory`} onClose={() => setModal('team')}>
          <MemoryPanel
            key={memoryBot.id}
            name={memoryBot.name}
            entries={(state?.memories ?? []).filter((entry) => entry.agentId === memoryBot.id)}
            onAdd={async (text) => {
              await api('/memories', { agentId: memoryBot.id, text });
              setState(await api<AppState>('/state'));
            }}
            onDelete={async (id) => {
              await api(`/memories/${id}`, { agentId: memoryBot.id }, 'DELETE');
              setState(await api<AppState>('/state'));
            }}
          />
        </Modal>
      )}
      {modal === 'details' && (
        <TaskDetailsDialog
          state={state}
          run={run}
          runs={chatRuns}
          team={runTeam}
          person={person}
          tab={tab}
          onTab={setTab}
          onSelectRun={setRunId}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'settings' && <SettingsDialog state={state} onClose={() => setModal(null)} />}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
