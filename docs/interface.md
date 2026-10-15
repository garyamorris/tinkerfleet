# Conversations, bots, and runs

A **bot persona** is a reusable identity and purpose within a fixed role. A
**conversation** is a named chat with selected participants, its own history, and
a draft. A **run** is one submitted task in that chat, with its own approvals,
activity, output, artifacts, and working file snapshot.

## Choose a direct or group chat

Choose **New chat** in the **Conversations** sidebar. In **New conversation**,
choose **One bot** for a direct chat or **Group chat** for two to four bots.
Select participants, optionally enter a **Conversation name**, then choose
**Start conversation**. Choosing a different bot with the same role replaces
that role's selection. There are no duplicate roles.

Return to a chat through its sidebar name, preview, and status. Use **Rename
conversation** in its header and **Save name** to change the title. Coordinator is
optional. You can create several independent chats with the same bot; each keeps
its own context and draft.

In live mode, a direct chat invokes that bot's SDK agent. A group with a
Coordinator delegates only to its selected specialists. A group without one
runs the selected agents sequentially under a shared budget. Separate chat
windows are not separate machines, accounts, or security sandboxes.

Demo mode stays scripted and adapts the tiny-project walkthrough to selected
participants. It does not turn a custom purpose into live intelligence. There
are no mentions, reply threads, autonomous background routines, or proactive
handoffs in this version.

## Create reusable profiles

Open the bot library, choose **Create persona**, and give the profile a name,
purpose, role, color, and avatar shape. **Save persona** stores it for selection
in new conversations. Names allow up to
40 characters; purposes allow up to 600 and may span multiple lines. For example,
a Researcher profile could “Explain unfamiliar TypeScript and find the smallest
relevant files.” The purpose reaches that bot's live SDK instructions.

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
snapshot. Participant identity and a workspace's file snapshot are separate.

## Continue a conversation

Select a chat in the sidebar to see its messages, draft, and status. Drafts are
saved locally in the browser and synchronized to the server. Submitting
another task adds a new run to that conversation. Only bounded history from this
chat supplies live context; another chat with the same bot is not included.

Each new run starts with a fresh isolated file snapshot. It does not inherit an
earlier run's in-memory edits, even within the same chat. Previous artifacts are
visible records, not a shared filesystem.

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
is not evidence that Docker or a model ran. Live errors must remain visible.

Use Tab and Shift+Tab to navigate controls and Enter or Space to activate buttons.
Read role labels rather than relying on color. Open the full action preview
before deciding, including on a narrow screen.

See the [handover](../HANDOVER.txt) for verified checks and remaining limitations.

## Recorded conversation checks

Browser checks confirmed independent direct chats, renaming, and separate drafts
across switching and reload. On a 390 × 844 viewport, the chat drawer showed
independent statuses and no horizontal page overflow. Approving a direct Maker
chat completed its edit while a separate Maker + Checker group's command stayed
pending; approving that group required its own decision. The group contained no
Coordinator or Scout. After a server restart, all seven chats retained their titles, authors, and
drafts, with the active direct chat still selected. A second direct message added
a new chronological run in the same chat. Group artifacts stayed in the group's
Changes view; the direct Quill chat's Changes remained empty. These were scripted
demo checks, not live model execution.
See [screenshots](../README.md#a-look-inside) and [verification](../HANDOVER.txt).
