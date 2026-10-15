# Conversations, bots, and runs

A **bot persona** is a reusable identity and personality. A
**conversation** is a named chat with selected participants, its own history, and
a draft. A **run** is one submitted task in that chat, with its own approvals,
activity, output, artifacts, and optional local actions.

## Start with the primary bot

Open **Orbit / Your coordinator** in the sidebar, or use **Talk to Orbit** on
the empty home screen. This returns to the primary bot's latest direct chat or
opens **Talk to a bot** with it preselected. Tell it what you want to accomplish.
It can answer directly
or bring agents into a shared group. You do not need to assemble the team
before explaining the task, and there is no manual group-start chooser.

In live mode, the Coordinator chooses up to seven available agents and creates at most one group per run. The group includes the
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
are no mentions, reply threads, or autonomous background routines. Saved per-bot
notes are separate from conversation history.

## Create reusable profiles

Ask the primary Coordinator: **“Create a patient Python tutor called Ada.”**
Its `create_agent` tool accepts a name and purpose/personality. Purpose
covers both work focus and personality—for example, patient explanations with
small exercises. Creation immediately creates a direct chat. Its message offers **Open this bot’s
chat**, and the profile also appears in the bot library. The Coordinator can use the new bot in a group
immediately.

Ordinary agents share the same enabled local and web tools. Scout, Maker, and
Checker are example personalities, not capability classes. In conversation-only
mode, no agent has workspace tools. When enabled, local reads and approval-gated
edits/commands are available to the primary and ordinary agents alike.

Only a private direct Coordinator has the creation tool. It may create up to
three profiles per run; the server library holds up to 32 profiles. Names
allow 40 characters and purposes 600. Existing browser profiles migrate into the
server-persisted library. Keep private data and credentials out of profile text;
it may become live model instructions and is not encrypted secret storage.

New chats use saved profiles. Existing conversation participants remain frozen,
so editing a library profile does not rewrite old chats or runs. The primary's
available roster adds new library profiles for future runs while keeping existing
IDs and their captured identities. A bot created during a run is
available for that run's group creation. A group can contain the primary plus up to seven ordinary agents.

The no-key demo recognizes the exact Ada example and persists the profile using
a scripted path. This verifies saving a bot, not live model behavior or a tutor's
personality in a conversation.

New profiles get a random avatar. **Randomize avatar** rerolls its appearance;
existing profiles keep their appearance unless you change it. Saving a manually
created persona opens its direct chat. **Talk to {name}** reuses an existing direct
chat or creates one when needed.

## Manage a bot’s memory

Choose **Memory** beside a bot in the library. Its memory dialog lists saved
notes with **Delete**, and provides **Add a memory** and **Save memory**. Each
bot can hold 20 notes of up to 2,000 characters each, 8,000 characters total.
Notes are saved on the local server and reused by the same bot across chats on
its next turn. Editing its personality does not erase memory.

The bot also has `remember`, `recall`, and `forget` tools. Memory is sent to the
provider when the bot replies; do not put credentials in it. Old transcripts
remain saved but are not automatically summarized or imported into notes.

## Continue a conversation

Select a chat in the sidebar to see its messages, draft, and status. Drafts are
saved locally in the browser and synchronized to the server. Submitting
another task adds a new run to that conversation. Only bounded history from this
chat supplies transcript context; another chat with the same bot is not included.
Saved notes for that bot are included separately across its conversations.

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

## Read formatted replies and activity

Assistant replies render headings, emphasis, lists, quotations, inline/fenced
code, tables, and task lists. Tables can scroll horizontally and receive keyboard
focus. Raw HTML stays inert, links allow HTTP(S) only, and images appear as text
labels without fetching remote images. Code is displayed, not executed.

Inline source citations remain clickable where their text positions match;
otherwise the source list remains available. An expandable **Details** activity
summary under each run shows recorded file, command, coordination, and web-tool
events. While a run works, it shows the latest recorded activity; afterward it
shows an activity count. Expand it for recent events, agent names, and elapsed
time. A started event is not a completed result, and no search progress is
invented when the provider has not supplied it.

## Review actions and results

Read an edit or complete command before approving. The decision belongs to one
exact action in one run and chat; switching chats never transfers permission.
Denial does not execute that action. Stopping invalidates pending approvals.

Use a run's **Task details** to inspect its activity, output, and changes.
The demo's output is labeled **SIMULATED DEMO OUTPUT**. A completed walkthrough
is not evidence that a command or a model ran. Live errors must remain visible.

Use Tab and Shift+Tab to navigate controls and Enter or Space to activate buttons.
Read agent names rather than relying on color. Open the full action preview
before deciding, including on a narrow screen.

See the [handover](../HANDOVER.txt) for verified checks and remaining limitations.

## Ask the primary to message an agent

The primary can send a concise brief to one ordinary agent and receive its reply
through that agent's individual conversation. Only the brief is shared; source
history is not copied automatically. The primary may make up to three deliveries
per run. This is an explicit message operation, not unattended background work
or shared memory across all chats.

## Returning an individual agent's reply

A delegated run returns a bounded, labeled recipient reply or status to the
source primary conversation. It is visible to the primary on its next turn.
Delivery does not automatically wake the primary model, recursively trigger
other agents, or prove that requested file actions completed. Follow the
recipient's actual status and results.

## Verified Markdown and tool activity

A combined live check read the practice file, ran exactly approved
`codex --version` successfully, and searched official Agents SDK documentation
with returned sources. The browser rendered the answer's heading, bullets, and
code block, plus recorded listing, read, command, and search start/finish events.
The [live reply](screenshots/markdown-tools-live.jpg),
[activity timeline](screenshots/tool-activity-live.jpg), and
[390 px mobile view](screenshots/mobile-markdown-tools.jpg) are genuine captures.
Desktop crops exclude the private chat list. This verifies those observed paths;
it does not imply every model or website supports all browsing actions.
See [the handover](../HANDOVER.txt).
