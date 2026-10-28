/**
 * The browser app. App owns the state (polled from the local server: quickly while a task works,
 * slowly when idle), the draft and conversation handlers, and the layout; panels and dialogs live
 * in their own files and receive what they show as props.
 */
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  AppState,
  Run,
  Approval,
  AgentId,
  Capability,
  Persona,
  Conversation,
} from '../shared/types';
import './style.css';
import { randomAppearance } from '../shared/appearance';
import { api, apiText, setCsrf } from './api';
import { BotLibraryDialog, CapabilitySummary, PersonaEditorDialog } from './bot-dialogs';
import {
  CAPABILITIES,
  grantedCapabilities,
  withLibraryCapabilities,
  type ServerCapabilities,
} from '../shared/capabilities';
import { directBotChat } from './bot-chat';
import { ChatList } from './chat-list';
import { ChatRun, type DetailsTab } from './chat-run';
import {
  CapabilitiesDialog,
  DeleteConversationDialog,
  NewConversationDialog,
  RenameDialog,
} from './conversation-dialogs';
import { loadDrafts, type ChatDraft } from './drafts';
import { MemoryPanel } from './memory-panel';
import { ScheduleDialogBody } from './schedule-dialog';
import { character, loadLibrary, resolveAgent, starterProfiles, validProfile } from './profiles';
import { SettingsDialog } from './settings-dialog';
import { starterPrompts } from './starters';
import { TaskDetailsDialog } from './task-details-dialog';
import { Avatar, AvatarStack, Icon, Menu, Modal, statusText } from './ui';

const active = (r: Run) => ['running', 'awaiting_approval'].includes(r.status);

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
    [deleting, setDeleting] = useState(false),
    [libraryImportError, setLibraryImportError] = useState(''),
    [chatErrors, setChatErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState(''),
    [modal, setModal] = useState<
      | 'team'
      | 'edit'
      | 'new'
      | 'rename'
      | 'chats'
      | 'details'
      | 'settings'
      | 'memory'
      | 'schedule'
      | 'capabilities'
      | 'delete-chat'
      | null
    >(null),
    [tab, setTab] = useState<string>('Activity'),
    [draft, setDraft] = useState<Persona>(starterProfiles[0]),
    [formError, setFormError] = useState(''),
    [chosen, setChosen] = useState<string[]>([]),
    [chatTitle, setChatTitle] = useState(''),
    [unseen, setUnseen] = useState(false),
    [, redrawDrafts] = useState(0);
  const [memoryBot, setMemoryBot] = useState<Persona | null>(null),
    [scheduleBot, setScheduleBot] = useState<Persona | null>(null);
  const openingBot = useRef(false);
  const messagesBox = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null);
  // Follow new messages only while you are at the bottom; reading further up is left alone.
  const stickToEnd = useRef(true),
    autoScrolling = useRef(false),
    lastScrollTop = useRef(0);
  const pollSoon = useRef<() => void>(() => {});
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
  // Which tool groups this server provides; each bot's profile chooses from these.
  const server: ServerCapabilities = {
    web: !!state?.webSearchEnabled,
    workspace: !!state?.workspaceToolsEnabled,
    memory: true,
  };
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
  const source = chat?.startedBy
    ? conversations.find((c) => c.id === chat.startedBy!.conversationId)
    : undefined;
  const person = (id: AgentId) =>
    resolveAgent(id, runTeam, source?.participants ?? [], library.profiles, starterProfiles);
  const currentActive = chatRuns.find(active);
  const busy = !!chat && busyChats.includes(chat.id);
  const prompt = chat ? (drafts.current[chat.id]?.text ?? chat.draft) : '';
  // Every task, in any chat, that is stopped until you approve or decline an action.
  const waiting = (state?.runs ?? [])
    .filter(
      (r) =>
        r.status === 'awaiting_approval' && conversations.some((c) => c.id === r.conversationId),
    )
    .sort((a, b) => a.startedAt - b.startedAt);
  const anyActive = (state?.runs ?? []).some(active) || busyChats.length > 0;
  useEffect(() => {
    if (anyActive) pollSoon.current();
  }, [anyActive]);
  useEffect(() => {
    document.title = `${waiting.length ? `(${waiting.length}) ` : ''}${
      chat ? `${chat.title} · Tinkerfleet` : 'Tinkerfleet · Your little team, in the loop.'
    }`;
  }, [waiting.length, chat?.title]);
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
    let alive = true,
      timer: ReturnType<typeof setTimeout> | undefined,
      lastText = '',
      fast = false;
    async function refresh() {
      try {
        const text = await apiText('/state');
        // An unchanged state is not parsed or rendered again.
        if (!alive || text === lastText) return;
        lastText = text;
        const data = JSON.parse(text) as AppState;
        fast = data.runs.some(active);
        setState(data);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    }
    // Poll quickly while a task works, slowly when idle, and rarely in a background tab.
    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(
        async () => {
          await refresh();
          if (alive) schedule();
        },
        document.hidden ? 5000 : fast ? 700 : 2000,
      );
    }
    pollSoon.current = () => {
      fast = true;
      schedule();
    };
    const onVisible = () => {
      if (!document.hidden) void refresh().then(() => alive && schedule());
    };
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
          schedule();
          document.addEventListener('visibilitychange', onVisible);
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
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      Object.values(saveTimers.current).forEach(clearTimeout);
    };
  }, []);
  function scrollToEnd(smooth: boolean) {
    const box = messagesBox.current;
    if (!box) return;
    autoScrolling.current = true;
    box.scrollTo({
      top: box.scrollHeight,
      behavior:
        smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto',
    });
  }
  // A different chat opens at its latest message.
  useLayoutEffect(() => {
    stickToEnd.current = true;
    setUnseen(false);
    scrollToEnd(false);
  }, [chat?.id, chatRuns.length > 0]);
  const last = chatRuns.at(-1);
  const decisions = chatRuns.reduce((n, r) => n + r.approvals.length, 0);
  useEffect(() => {
    if (stickToEnd.current) scrollToEnd(true);
    else setUnseen(true);
  }, [last?.id, last?.messages.length, last?.status, decisions]);
  // The message box grows with what you type, up to a limit set in the stylesheet.
  useLayoutEffect(() => {
    const box = composer.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight + 2}px`;
  }, [prompt, chat?.id]);
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
  async function deleteChat() {
    if (!chat || deleting) return;
    const id = chat.id;
    setDeleting(true);
    setFormError('');
    try {
      await api(`/conversations/${id}`, {}, 'DELETE');
      delete drafts.current[id];
      cacheDrafts();
      setState(await api<AppState>('/state'));
      // The most recent remaining chat opens next.
      setChatId(null);
      setModal(null);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }
  async function start(text: string) {
    if (!chat || busy || currentActive || !state || !text.trim()) return;
    const id = chat.id,
      version = drafts.current[id]?.version ?? 0;
    markBusy(id, true);
    setChatErrors((errors) => ({ ...errors, [id]: '' }));
    // Your own message always scrolls into view.
    stickToEnd.current = true;
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
  // Granting from a "Created …" message is the same edit as ticking the boxes in the library.
  async function grantCapabilities(bot: Persona, capabilities: Capability[]) {
    await api(`/profiles/${bot.id}`, { capabilities });
    setState(await api<AppState>('/state'));
  }
  async function saveProfile() {
    if (savingProfile) return;
    setFormError('');
    if (
      library.profiles.some((p) => p.id === draft.id && p.role === 'coordinator') &&
      draft.role !== 'coordinator'
    ) {
      setFormError(
        'The primary bot stays primary. You can change its personality, name, and appearance.',
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
  async function deleteBot(bot: Persona) {
    setFormError('');
    try {
      await api(`/profiles/${bot.id}`, {}, 'DELETE');
      setState(await api<AppState>('/state'));
      setModal('team');
    } catch (e) {
      setFormError((e as Error).message);
    }
  }
  function goToWaiting() {
    const target = waiting.find((r) => r.conversationId !== chat?.id) ?? waiting[0];
    if (!target?.conversationId) return;
    if (target.conversationId !== chat?.id) chooseChat(target.conversationId);
    else {
      stickToEnd.current = true;
      scrollToEnd(true);
      document.querySelector<HTMLButtonElement>('.approval-card .primary')?.focus();
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
        .find((s) => s.id === c.startedBy?.conversationId)
        ?.participants.find((p) => p.id === c.startedBy?.coordinatorId)?.name ??
      c.participants.find((p) => p.id === c.startedBy?.coordinatorId)?.name ??
      'the primary bot'
    );
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
      onTalkToPrimary={() => void openBot(team[0])}
      onNew={() => openNew()}
      onChoose={chooseChat}
      onOpenLibrary={() => setModal('team')}
    />
  );
  const live = state?.mode === 'live';
  const modeDetail = live
    ? `${state?.workspaceToolsEnabled ? 'Local file tools on' : 'No file access or commands'} · Only this conversation’s participants see its context.`
    : 'No API calls. Tools act on a temporary copy of tiny-project.';
  const modeChip = (
    <button
      className="mode-chip"
      onClick={() => setModal('settings')}
      title="Mode and settings"
      aria-label={`${live ? 'Live chat' : 'Scripted demo'}: mode and settings`}
    >
      <span className={`mode-dot ${live ? 'live' : ''}`} />
      {live ? 'Live' : 'Demo'}
    </button>
  );
  const solo = chat?.participants.length === 1 ? chat.participants[0] : undefined;
  const starters = solo
    ? starterPrompts(
        solo,
        live ? 'live' : 'demo',
        grantedCapabilities(withLibraryCapabilities(solo, library.profiles), server),
        library.profiles.filter((p) => p.id !== solo.id),
      )
    : [];
  return (
    <div className="app">
      <a className="skip-link" href={chat ? '#message-box' : '#main'}>
        {chat ? 'Skip to message box' : 'Skip to main content'}
      </a>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
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
          {waiting.length > 0 && (
            <button
              className="waiting-badge"
              onClick={goToWaiting}
              aria-label={`${waiting.length} ${waiting.length === 1 ? 'task is' : 'tasks are'} waiting for your approval. Go to ${waiting.length === 1 ? 'it' : 'the first'}.`}
            >
              <Icon name="shield" size={16} />
              <span>{waiting.length}</span>
              <span className="waiting-text">waiting for you</span>
            </button>
          )}
          <button className="mobile-only" onClick={() => setModal('chats')}>
            <Icon name="layers" size={18} />
            <span>Chats</span>
          </button>
          <button className="mobile-only" onClick={() => setModal('team')}>
            <Icon name="team" size={18} />
            <span>Bots</span>
          </button>
        </nav>
      </header>
      <div className="workspace-layout">
        <aside className="chat-sidebar">{chatList}</aside>
        <main className="conversation" id="main" tabIndex={-1}>
          {chat && (
            <header className="chat-heading">
              <AvatarStack people={chat.participants.map(character)} size={30} max={4} />
              <div className="chat-heading-text">
                <h1>{chat.title}</h1>
                <p className="chat-subtitle">
                  <span className="chat-subtitle-main">
                    {solo ? (
                      <>
                        {chat.title !== solo.name && `${solo.name} · `}
                        Can use:{' '}
                        <CapabilitySummary
                          profile={withLibraryCapabilities(solo, library.profiles)}
                          server={server}
                        />
                      </>
                    ) : (
                      chat.participants.map((p) => p.name).join(', ')
                    )}
                  </span>
                  {source && (
                    <button
                      className="inline-link"
                      title={`Started by ${startedByName(chat)}`}
                      onClick={() => chooseChat(source.id)}
                    >
                      <Icon name="back" size={13} />
                      Original conversation
                    </button>
                  )}
                </p>
              </div>
              {modeChip}
              <Menu
                label="Conversation options"
                items={[
                  {
                    label: 'Rename',
                    icon: 'edit',
                    onSelect: () => {
                      setChatTitle(chat.title);
                      setFormError('');
                      setModal('rename');
                    },
                  },
                  ...(solo
                    ? []
                    : [
                        {
                          label: 'What each bot can do',
                          icon: 'team',
                          onSelect: () => setModal('capabilities'),
                        },
                      ]),
                  {
                    label: 'Delete conversation',
                    icon: 'trash',
                    danger: true,
                    onSelect: () => {
                      setFormError('');
                      setModal('delete-chat');
                    },
                  },
                ]}
              />
            </header>
          )}
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
          <div
            className="messages"
            ref={messagesBox}
            onScroll={(e) => {
              const box = e.currentTarget,
                atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 120,
                movedUp = box.scrollTop < lastScrollTop.current - 2;
              lastScrollTop.current = box.scrollTop;
              // An automatic scroll only moves down; moving up is you, however you scrolled.
              if (autoScrolling.current && !movedUp) {
                if (atEnd) autoScrolling.current = false;
                return;
              }
              autoScrolling.current = false;
              stickToEnd.current = atEnd;
              if (atEnd) setUnseen(false);
            }}
            // Any scrolling of your own takes over from an automatic scroll.
            onWheel={() => (autoScrolling.current = false)}
            onTouchStart={() => (autoScrolling.current = false)}
            onKeyDown={() => (autoScrolling.current = false)}
          >
            {!chat ? (
              <section className="welcome">
                <div className="welcome-avatars">
                  <Avatar person={character(team[0])} size={72} />
                </div>
                <h1>Start with {team[0].name}.</h1>
                <p>
                  Tell your primary bot what you want to do. {team[0].name} can answer, create new
                  bots, and hand them work.
                </p>
                <button
                  className="primary"
                  onClick={() => void openBot(team[0])}
                  disabled={!state || creating}
                >
                  Talk to {team[0].name}
                  <Icon name="forward" size={17} />
                </button>
                <div>
                  <button className="text-button" onClick={() => setModal('team')}>
                    Create and manage your bots
                  </button>
                </div>
                <div className="welcome-mode">
                  {modeChip}
                  <span>{modeDetail}</span>
                </div>
              </section>
            ) : !chatRuns.length ? (
              <section className="welcome chat-welcome">
                <div className="welcome-avatars">
                  {chat.participants.map((p) => (
                    <Avatar key={p.id} person={character(p)} size={60} />
                  ))}
                </div>
                <h1>{solo ? `Meet ${solo.name}.` : 'A conversation for your team.'}</h1>
                <p>
                  {solo
                    ? solo.role === 'coordinator'
                      ? 'Tell me what you want to work on. I can answer, create a bot with the right personality, or hand work to one when that helps.'
                      : solo.purpose
                    : `${chat.participants.map((p) => p.name).join(', ')} are here. Only these bots take part in this chat.`}
                </p>
                {starters.length > 0 && (
                  <div className="starters" role="group" aria-label="Try one of these">
                    {starters.map((text) => (
                      <button
                        key={text}
                        className="starter"
                        disabled={!state || busy || !!currentActive}
                        onClick={() => start(text)}
                      >
                        <span>{text}</span>
                        <Icon name="forward" size={15} />
                      </button>
                    ))}
                  </div>
                )}
                {!live && starters.length > 0 && (
                  <p className="starter-note">
                    The demo’s scripted model knows these examples. It makes real tool calls and
                    asks for real approvals on a temporary copy of tiny-project.
                  </p>
                )}
              </section>
            ) : (
              <div className="thread" role="log" aria-label="Messages">
                {chatRuns.map((r) => (
                  <ChatRun
                    key={r.id}
                    run={r}
                    chat={chat}
                    conversations={conversations}
                    allRuns={state?.runs ?? []}
                    profiles={library.profiles}
                    workspaceRoot={state?.workspaceRoot ?? ''}
                    busy={busyChats.includes(chat.id)}
                    creating={creating}
                    server={server}
                    onDecide={decide}
                    onGrant={grantCapabilities}
                    onOpenBot={(bot, conversationId) => void openBot(bot, conversationId)}
                    onChooseChat={chooseChat}
                    onShowDetails={(id, nextTab: DetailsTab) => {
                      setRunId(id);
                      setTab(nextTab);
                      setModal('details');
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          {chat && (
            <div className="composer-area">
              {unseen && (
                <button
                  className="new-messages"
                  onClick={() => {
                    stickToEnd.current = true;
                    setUnseen(false);
                    scrollToEnd(true);
                  }}
                >
                  <Icon name="down" size={15} />
                  New messages
                </button>
              )}
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
                  id="message-box"
                  rows={1}
                  maxLength={8000}
                  aria-label={`Message ${chat.title}`}
                  aria-describedby="composer-keys"
                  placeholder={
                    currentActive
                      ? 'Draft your next message…'
                      : `Message ${solo ? solo.name : 'this group'}…`
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
                <span>
                  {live ? 'Live model' : 'Scripted demo'} · {modeDetail}
                </span>
                <span id="composer-keys" className="composer-keys">
                  Enter to send · Shift+Enter for a new line
                </span>
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
          server={server}
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
      {modal === 'capabilities' && chat && (
        <CapabilitiesDialog
          participants={chat.participants}
          profiles={library.profiles}
          server={server}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'delete-chat' && chat && (
        <DeleteConversationDialog
          title={chat.title}
          busy={!!currentActive}
          error={formError}
          deleting={deleting}
          onDelete={() => void deleteChat()}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'team' && (
        <BotLibraryDialog
          profiles={orderedProfiles}
          schedules={state?.schedules ?? []}
          server={server}
          legacyLibrary={legacyLibrary}
          importError={libraryImportError}
          creating={creating}
          onEdit={(p) => {
            setFormError('');
            // A profile saved before capabilities had every enabled tool; the editor shows that.
            setDraft({ ...p, capabilities: p.capabilities ?? [...CAPABILITIES] });
            setModal('edit');
          }}
          onCreate={() => {
            setFormError('');
            setDraft({
              id: crypto.randomUUID(),
              role: 'agent',
              name: '',
              purpose: '',
              capabilities: ['read', 'memory'],
              ...randomAppearance(),
            });
            setModal('edit');
          }}
          onMemory={openMemory}
          onSchedule={(p) => {
            setScheduleBot(p);
            setModal('schedule');
          }}
          onTalk={(p) => void openBot(p)}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'edit' && (
        <PersonaEditorDialog
          draft={draft}
          server={server}
          isNew={!library.profiles.some((p) => p.id === draft.id)}
          error={formError}
          saving={savingProfile}
          onChange={setDraft}
          onSubmit={saveProfile}
          onDelete={
            library.profiles.some((p) => p.id === draft.id && p.role !== 'coordinator')
              ? () => deleteBot(draft)
              : undefined
          }
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
      {modal === 'schedule' && scheduleBot && (
        <Modal title={`${scheduleBot.name}’s schedules`} onClose={() => setModal('team')}>
          <ScheduleDialogBody
            key={scheduleBot.id}
            bot={library.profiles.find((p) => p.id === scheduleBot.id) ?? scheduleBot}
            schedules={(state?.schedules ?? []).filter((s) => s.botId === scheduleBot.id)}
            runs={state?.runs ?? []}
            schedulesRun={!!state?.schedulesRun}
            timeZone={state?.timeZone ?? 'local time'}
            hasChat={(id) => conversations.some((c) => c.id === id)}
            onSave={async (draft, id) => {
              await api(id ? `/schedules/${id}` : '/schedules', {
                ...(id ? {} : { botId: scheduleBot.id }),
                ...draft,
              });
              setState(await api<AppState>('/state'));
            }}
            onPause={async (schedule, paused) => {
              await api(`/schedules/${schedule.id}`, { paused });
              setState(await api<AppState>('/state'));
            }}
            onDelete={async (schedule) => {
              await api(`/schedules/${schedule.id}`, {}, 'DELETE');
              setState(await api<AppState>('/state'));
            }}
            onOpenChat={(id) => {
              setModal(null);
              chooseChat(id);
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
