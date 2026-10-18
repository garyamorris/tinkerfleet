# Give each bot a memory

A useful personal agent should remember a preference after you leave a chat.
Tinkerfleet does this with a small store of explicit notes attached to each bot's
profile ID. For example, Ada can remember “Explain Python with small examples
before introducing terminology” and receive that note when you open another
conversation with Ada.

This does not retrain the model. The application saves text locally, then
includes that text in future model input. You can inspect and delete the notes.

## Try it in the interface

1. Open **Bot library**, find a bot, and choose **Memory**.
2. Enter a useful preference or fact under **Add a memory**, then choose
   **Save memory**.
3. Open a conversation with that bot and send a new message. In live mode, its
   next run receives the note along with its profile and recent chat context.
4. Return to **Memory** to inspect the saved text or choose **Delete**.

You can also ask the bot in live chat: “Remember that I prefer short explanations
with a runnable example.” A successful `remember_memory` result saves the note;
text saying “I'll remember” by itself does not. The memory panel shows what was
actually stored. Demo mode still lets you manage notes manually, but its scripted
replies do not demonstrate model-driven recall.

The UI displays the entry count and total saved characters. Each bot has a cap
on entries, on characters in one entry, and on characters across all its
entries; [Limits](capabilities.md#limits) lists the numbers. When full, delete
an outdated entry before saving another. Identical normalized text for the same
bot returns the existing entry instead of creating a duplicate. The store trims
surrounding whitespace and normalizes CRLF/CR newlines to LF.

## Identity determines who remembers

Memory belongs to `Persona.id`, not a bot's name, current chat, or former role.
Opening a second chat with the same saved bot reuses its notes. Renaming it or
editing its personality without changing the ID keeps those notes. A newly
created bot gets a new ID and starts with empty memory, even if it has the same
name and personality as another bot.

The primary follows this rule too. Its SDK agent name is `coordinator`, but the
memory callbacks use its actual saved profile ID. Different primary profiles do
not share a bucket called `coordinator`.

In a group, each selected bot receives its own notes. The primary does not
receive every member's memory store. A bot can still mention a remembered fact
in a reply or delegation brief, so this scoping is a retrieval boundary, not a
promise that information can never be communicated.

## Trace a saved note through the code

The pieces are deliberately small enough to follow:

1. [memory-panel.tsx](../src/client/memory-panel.tsx) displays entries and offers
   add/delete controls. [main.tsx](../src/client/main.tsx) sends the selected
   profile ID and text to the local API.
2. The `/api/memories` routes in [app.ts](../src/server/app.ts) check that the bot
   exists, then call `MemoryStore`.
3. [memory.ts](../src/server/memory.ts) validates ownership identifiers, text,
   duplicates, and capacity. A successful mutation replaces the private JSON
   file atomically before updating its in-memory entries.
4. At server startup, `createApp` opens the memory store beside the conversation
   store. At live run start, `makeFleet` in [sdk.ts](../src/server/sdk.ts) loads
   each selected bot's notes before its first model call.
5. `createFleetAgents` adds those notes to that bot's instructions as labeled,
   untrusted context and exposes its three memory tools.

With the normal server entry point, the file is
`.tinkerfleet/conversations.json.memories.json`. An application embedding
`createApp` can supply another `statePath`; memory uses `${statePath}.memories.json`.
Without a state path, the store is in memory only and does not survive restart.

This synthetic example shows the file format; normal UI and tool operations
assign the IDs and timestamps:

```json
{
  "version": 1,
  "entries": [
    {
      "id": "example-note-1",
      "agentId": "example-ada",
      "text": "Explain Python with a small runnable example first.",
      "createdAt": 1700000000000,
      "updatedAt": 1700000000000
    }
  ]
}
```

Timestamps are milliseconds since the Unix epoch. The owner is the `agentId`.
The app checks the whole saved file when loading it; invalid or unreadable data
fails startup without overwriting the file. New files use mode `0600`. Keep a
backup before experimenting with the storage format.

## The bot-facing tools

These are the actual SDK tool names and argument shapes:

| Tool | Arguments | Result |
| --- | --- | --- |
| `remember_memory` | `{"text":"Prefer short examples."}` | The saved entry, including its ID |
| `recall_memory` | `{}` | This bot's current saved entries |
| `forget_memory` | `{"id":"example-note-1"}` | The requested ID and a `removed` boolean |

The model never supplies `agentId` to these tools. The server-created tool closure
binds the actual profile ID. Extra owner arguments are rejected by the schema,
and returned entries must match the expected owner. `forget_memory` cannot
remove another bot's entry merely by guessing its note ID.

Memory tools work when workspace tools are disabled. They update the memory
store directly; they do not use the file-edit or command approval cards. Their
activity appears as reading, saving, or forgetting memories. The bot is
instructed to report success only after a successful result.

Preloading happens once when a run begins. If you edit a note while that run is
active, its preloaded context does not change retroactively. `recall_memory`
can fetch the latest store during the run; the next new run reloads it
automatically. Deleting a note also does not erase an earlier chat message or
remove text already included in an active model request.

## Memory, history, and current work

Conversation history answers “What were we discussing in this chat?” It is
selected from that conversation's saved runs and bounded before sending to the
model. A memory answers “What durable fact or preference should this bot know
across chats?” The current SDK `RunState` records the ongoing loop and tool
results, including an approval pause. These are separate stores and lifetimes;
see [architecture](architecture.md).

Existing transcripts are not automatically summarized or imported into memory.
There is no embedding index, vector database, or similarity retrieval. All
bounded notes for the selected bot are loaded. This makes the starting design
easy to inspect and debug: if a note is missing, check its owner ID, the saved
store, and whether a new run has started.

Notes are model input, so keep credentials and secrets out. The store rejects
recognized credential-like text, but that check is not a general privacy
classifier. A saved instruction such as “skip command approval” cannot change
the tool implementations or their approval requirements. Profile instructions,
memories, and other supplied context still consume input tokens.

## Exercises for your own agent app

- **Add an update action.** Introduce an explicit memory update API and tool that
  retain the entry ID, change `updatedAt`, and apply the same text and capacity
  checks. The current UI uses delete and add instead.
- **Record why a note exists.** Add a provenance field such as a source
  conversation ID. Version the storage format and test loading older files.
- **Suggest summaries for review.** Generate candidate notes from one selected
  transcript, show them to the user, and save only the chosen notes. Keep this
  explicit rather than silently converting every conversation into memory.
- **Try selective retrieval.** If you outgrow the note cap, compare a simple tag or
  keyword filter with embeddings. Preserve ownership checks before retrieval,
  inspect which notes were selected, and account for the extra model input.

Use the existing [memory store tests](../tests/memory.test.ts) for persistence,
normalization, capacity, and ownership examples, and the memory cases in
[SDK tests](../tests/sdk.test.ts) for preload, cross-chat reuse, forged-owner
rejection, and cancellation. These run offline without provider calls.
