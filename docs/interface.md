# Conversations, bots, and runs

A **bot persona** is a reusable identity and purpose within a fixed role. A
**conversation** is a named chat with selected participants, its own history, and
a draft. A **run** is one submitted task in that chat, with its own approvals,
activity, output, artifacts, and optional local actions.

## Start with the primary bot

Open **Orbit / Your coordinator** in the sidebar, or use **Talk to Orbit** on
the empty home screen. This returns to the primary bot's latest direct chat or
opens **Talk to a bot** with it preselected. Tell it what you want to accomplish.
It can answer directly
or bring specialists into a shared group. You do not need to assemble the team
before explaining the task, and there is no manual group-start chooser.

In live mode, the Coordinator chooses one to three available specialists with
different roles and creates at most one group per run. The group includes the
Coordinator and begins its own task from a bounded brief. Your private direct
conversation history is not copied into it. Group participants cannot create
further groups. The primary and group have separate run budgets and stop controls.
Stopping the primary does not stop a group already started; open the group and
stop it explicitly. A single user turn may consume two run budgets in live mode.

When a group is created, its link card offers **Open conversation**. You stay in
the source chat until you choose to open it. Group headers show **Started by**
the Coordinator; **Original conversation** returns to the source chat.

Use the sidebar to return to the primary chat or a created group. **Talk to a
bot** opens a direct-only picker with an optional **Conversation name** and
**Start conversation**. The bot library also provides **Talk to {name}** actions. Named conversations retain separate previews, status,
drafts, and history. Multiple independent chats can use the same bot. Existing
groups remain available after this workflow change.

In the no-key demo, a request to fix the failing tests in tiny-project triggers
a clearly scripted group creation. A simple greeting stays in the primary chat.
That demonstrates the interaction without claiming live model judgment. There
are no mentions, reply threads, autonomous background routines, or cross-chat
memory in this version.

## Create reusable profiles

Ask the primary Coordinator: **“Create a patient Python tutor called Ada.”**
Its `create_agent` tool accepts a name, purpose, and specialist role. Purpose
covers both work focus and personality—for example, patient explanations with
small exercises. A successful creation message offers **Talk**, and the profile
also appears in the bot library. The Coordinator can use the new bot in a group
immediately.

The three capability templates are Researcher (`scout`), Builder (`maker`), and
Reviewer (`checker`). With workspace tools enabled, Researcher is read-only;
Builder and Reviewer can propose local edits and installed commands, each needing
approval. In conversation-only mode, no workspace tools are available. A purpose
cannot grant new tools or bypass approval.

Only a private direct Coordinator has the creation tool. It may create up to
three profiles per run; the server library holds up to 32 profiles. Names
allow 40 characters and purposes 600. Existing browser profiles migrate into the
server-persisted library. Keep private data and credentials out of profile text;
it may become live model instructions and is not encrypted secret storage.

New chats use saved profiles. Existing conversation participants remain frozen,
so editing a library profile does not rewrite old chats or runs. The primary's
available roster adds new library profiles for future runs while keeping existing
IDs and their captured identities. A bot created during a run is
available for that run's group creation. Group membership still allows only one
specialist per capability role.

The no-key demo recognizes the exact Ada example and persists the profile using
a scripted path. This verifies saving a bot, not live model behavior or a tutor's
personality in a conversation.

## Continue a conversation

Select a chat in the sidebar to see its messages, draft, and status. Drafts are
saved locally in the browser and synchronized to the server. Submitting
another task adds a new run to that conversation. Only bounded history from this
chat supplies live context; another chat with the same bot is not included.

Workspace-enabled runs operate on the real selected folder. Approved edits and
command effects persist there. Other chats using that folder can observe those
changes even though their conversation histories are separate. Artifacts are
records, not a guarantee of the file's current contents.

Reload returns to the active chat while the server continues its work. The
server saves visible chat history locally in `.tinkerfleet/conversations.json`.
After a server restart, history remains, but unfinished runs are cancelled and
pending approvals denied. Submit a fresh task to continue; the old execution
cannot resume. Legacy saved runs become independent conversations.

## Search and inspect sources

In live mode, ask for a public-web lookup or provide a public URL. Search-enabled
answers can show clickable sources; open them to check the evidence. Page reading
depends on model support. This does not access a logged-in browser or automate
forms. The demo never searches the web, and a source link alone is not proof that
a claim is correct.

## Review actions and results

Read an edit or complete command before approving. The decision belongs to one
exact action in one run and chat; switching chats never transfers permission.
Denial does not execute that action. Stopping invalidates pending approvals.

Use a run's **Task details** to inspect its activity, output, and changes.
The demo's output is labeled **SIMULATED DEMO OUTPUT**. A completed walkthrough
is not evidence that a command or a model ran. Live errors must remain visible.

Use Tab and Shift+Tab to navigate controls and Enter or Space to activate buttons.
Read role labels rather than relying on color. Open the full action preview
before deciding, including on a narrow screen.

See the [handover](../HANDOVER.txt) for verified checks and remaining limitations.

## Recorded primary-first checks

The existing primary chat retained its messages while initializing its specialist
roster. Asking Orbit about the fixture created a linked Tiny-project repair group
with Scout, Maker, and Checker; the primary chat stayed selected. The group showed
**Started by Orbit**, an **Original conversation** link, and a Coordinator-authored
initial brief. Both group approvals completed. An independent direct Quill chat
completed while the group awaited its command approval. At 390 × 844, the page
had no horizontal overflow and the approval controls were fully visible.
After the final server restart, all ten conversations, the existing Maker draft,
and completed group history returned. The source invitation and group provenance
links persisted, and navigation worked in both directions.
These were no-key demo checks. See [screenshots](../README.md#a-look-inside) and
[the handover](../HANDOVER.txt) for the latest verification limits.

## Recorded creation check

The no-key Ada example created a saved profile, its creation card opened a direct
chat, and Ada remained after restart. The checked state retained two chats, one
run, and five profiles. Mobile at 390 × 844 had no horizontal overflow. This
verifies the scripted creation path and persistence, not live personality or
hosted search. See [screenshots](../README.md#a-look-inside) and the
[handover](../HANDOVER.txt) for the exact verification scope.
