# Learn the app by using it

The interface makes an agent application's moving parts visible. Each bot in
the library is a saved bot profile. Each entry in the sidebar is a conversation,
with its participants, messages, draft, and status. Each submitted message and
its result is a run, with its activity, approvals, and output. The
[build guide's table](build-an-agent-app.md#2-build-the-chat-before-adding-autonomy)
compares these three objects. A memory note is a fact saved for one bot across
its conversations. Use this tour alongside [Build an agent app](build-an-agent-app.md).

## Start with the primary

Choose the primary agent in the sidebar and describe what you want to do. Orbit
is the default primary. It can answer or do simple enabled tool work itself; it
can also create agents, message one, or start a group when collaboration helps.

Each bot has capabilities, chosen in **Bot library → Edit**: web, read files,
edit files, run commands, and memory. The starter Scout searches the web, Maker
reads and edits, and Checker reads and runs commands. The chat header lists what
each participant can do; in a group, open **What each bot can do**. The direct
primary has extra coordination tools. Changing a personality does not enable a
tool or remove an approval requirement.

In the no-key demo, ask to fix the failing tests in tiny-project. The primary's
scripted model calls `start_group_conversation`, just as a real model would. A greeting stays in the primary chat.
This is a useful way to inspect the interaction before trying real models.

## Create a bot you want to talk to

In live mode, try: **“Create a patient Python tutor called Ada.”** The primary
can turn that request into a saved name and purpose/personality. Its creation
card offers **Open this bot’s chat**: the direct conversation already exists,
so one click opens it.

You can also open **Bots**, choose **Create persona**, and write the profile
yourself. Saving a new persona opens its direct chat. New profiles receive a
random avatar; **Randomize avatar** changes the appearance. It does not change
the bot's tools or intelligence.

Use **Talk to {name}** in the library to return to a bot's direct chat, or use
**Talk to a bot** to start a separate conversation with an optional name. Separate
chats are useful for separate topics. Library edits affect new conversations;
existing participants keep their captured identities.

The demo recognizes the documented Ada creation example, but arbitrary
personality requests need a live model. Saving a profile in the demo is real
storage, not proof of the model adopting that personality.

## Follow messages and groups

Ask the primary to send an agent a concise task. The recipient works in an
individual conversation. A bounded, labeled reply or status is returned to the
source primary chat and becomes available on the primary's next turn. This does
not automatically wake the primary for another model call.

For a group, the primary chooses participants and shares a brief. Its link card
opens the new conversation; you remain in the source chat until you choose that
link. The group shows **Started by** and an **Original conversation** backlink.
There is no manual group-start chooser.

A group can include the primary and a limited number of ordinary agents
([Limits](capabilities.md#limits)). The shared brief does not automatically
include the source chat's private history. The
source and child conversations have separate runs, approvals, and stop controls.
If you stop the primary, open and stop any child run you also want to end.
Agents called inside a group share the group run’s model-call, token, and runtime
budgets; each internal agent call does not create a new conversation run.

## Give one bot a useful memory

Open **Memory** beside a bot in the library. Add a harmless preference such as
“I prefer short explanations followed by one exercise,” then choose **Save
memory**. You can inspect saved notes and use **Delete** to remove one.

The same bot receives these notes on its next turn across chats. Another bot
does not receive them merely because it is in your library. Each bot has a cap
on notes and characters ([Limits](capabilities.md#limits)). Personality
edits do not erase notes, and old chat transcripts are not imported automatically.

Notes are stored locally and sent to the provider when that bot replies. Keep
credentials out of them. See [Memory](memory.md) for the underlying store and
model tools.

**Try it:** save a sample note, reload, and inspect it again. In live mode, start
a separate conversation with that same bot and ask about the preference. In
demo mode, inspect persistence without expecting a model-generated recall.

## Review a proposed action

With local tools enabled, a bot can read permitted project files and propose an
edit or command. Read the full proposal: the destination and contents for an
edit, or the executable, arguments, and working directory for a command.

Approve only the action you want. That decision belongs to one exact action in
one run. Denial does not execute it, and switching chats never transfers the
approval. An approved native action changes real files or starts a real local
process. In the demo, that real file and process are in a temporary copy of
tiny-project.

Open **Task details** to inspect output and changes. An artifact records what a
run produced; another action may have changed the real file since then. Learn
how that boundary works in [Capabilities](capabilities.md) and
[Approvals](approvals.md).

## Read answers and follow activity

Replies support Markdown headings, lists, quotations, code blocks, tables, and
task lists. Displayed code does not execute. Tables can scroll; images appear as
text labels without remote image downloads. Raw HTML is inert.

Source citations link to the evidence behind web answers. When a citation cannot
be positioned reliably inside formatted text, it remains in the source list.
Open the source and check the claim yourself.

Expand the **Details** activity summary beneath a run to see recent recorded
steps, agent names, and elapsed time. A file-read event or completed command is
more useful evidence than a sentence promising to do the work. A started event
alone is not proof of completion. The UI only reports activity supplied by the
local tools or provider.

To see what each model call actually sent and received, open **Task details**
and choose **Trace**. See [Reading a trace](traces.md).

## Leave and return

The sidebar keeps named chats with previews and status. You can rename a
conversation, switch chats with different drafts, and return after reloading.
A server restart preserves saved history but cancels unfinished runs and denies
pending approvals. Submit a new message to continue; an old approval cannot
resume execution.

On a narrow screen, open the conversation drawer to switch chats. Use Tab to
move through controls, Enter or Space to activate buttons, and Escape to close
dialogs. Read labels as well as avatar colors.

## Find these ideas in the code

| Interaction | Start reading here |
| --- | --- |
| Sidebar, creation cards, dialogs, and run display | [`src/client/main.tsx`](../src/client/main.tsx), [`chat-list.tsx`](../src/client/chat-list.tsx), [`chat-run.tsx`](../src/client/chat-run.tsx), and the `*-dialog(s).tsx` files |
| Memory editor | [`src/client/memory-panel.tsx`](../src/client/memory-panel.tsx) |
| Saved chats and drafts | [`src/server/conversations.ts`](../src/server/conversations.ts) |
| Agent instructions and model tools | [`src/server/sdk/fleet.ts`](../src/server/sdk/fleet.ts) and [`sdk/run-fleet.ts`](../src/server/sdk/run-fleet.ts) |
| Exact action decisions | [`src/server/approval.ts`](../src/server/approval.ts) |

You do not need to read every file at once. Pick one visible interaction, follow
its data through [the architecture](architecture.md), then change a small part
and check it with the [testing guide](testing.md).
