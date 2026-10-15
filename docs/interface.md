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

Open the bot library, choose **Create persona**, and give the profile a name,
purpose, role, color, and avatar shape. **Save persona** stores it for selection
in new conversations. Names allow up to
40 characters; purposes allow up to 600 and may span multiple lines. For example,
a Researcher profile could “Explain unfamiliar TypeScript and find the smallest
relevant files.” The purpose reaches that bot's live SDK instructions.

Live conversation-only mode supplies no workspace tools to any role. The role
capabilities below apply when `TINKERFLEET_WORKSPACE_TOOLS=1` is enabled.
Roles define capability. Researcher (`scout`) is read-only. Builder (`maker`) and
Reviewer (`checker`) can propose edits and commands, each subject to approval.
Coordinator coordinates its selected group. Purpose text cannot add tools or
bypass approval; colors and shapes affect appearance only.

The reusable library is stored in this browser. It does not sync between
browsers; clearing site data removes local preferences. Existing cosmetic
preferences migrate into profiles. Keep credentials and private information out
of profile text: it is not encrypted secret storage, and selected names/purposes
may be sent to OpenAI in live mode.

Creating a chat captures its participant profiles. Editing a library profile
later does not rewrite existing conversation participants or earlier runs.
Create a new chat to use the revised profile. Each run also keeps its own team
snapshot of participant profiles. This does not copy or isolate workspace files.

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
