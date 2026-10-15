# Setup and privacy

## Run the demo

Install Node.js 24+ and npm, then run from the repository root:

```sh
npm ci
npm run dev
```

Open http://localhost:4317. The no-key demo is scripted. It makes no model calls,
runs no commands, and edits no real files. Docker is not required.

Start with Orbit, the primary Coordinator. Ask about the tiny-project fixture to
see it create a agent group, then review the simulated approvals. A greeting
stays in the primary chat. The six `npm run lesson:1` through `lesson:6` commands
teach the building blocks without model calls.

## Enable real model conversations

Supply your own server-side API key and a tool-capable model available to your
account. Live mode can incur API charges. Keep keys out of browser settings,
profile text, screenshots, and source control.

```sh
cp .env.example .env.local
```

Set these values privately in `.env.local`:

```dotenv
TINKERFLEET_MODE=live
TINKERFLEET_MODEL=your-model-id
OPENAI_API_KEY=your-own-key
TINKERFLEET_WORKSPACE_TOOLS=0
```

Then load it explicitly:

```sh
node --env-file=.env.local --import tsx src/server/index.ts
```

Placeholders are not usable credentials. `.env.local` is ignored by Git; verify
that before committing. You can instead use your existing secret-management
workflow. The app never asks for a key in the browser.

Conversation-only live mode is the default. Bots discuss supplied information
and the Coordinator can create groups. Workspace read, edit, and command tools
are absent; no host project is captured. Saved local chat history is still read
and written. Docker is not part of the active app.

## Public web search

Live mode enables OpenAI's hosted web-search tool by default. Ask for current
public information or supply a public page URL. Responses can include clickable
source links; inspect the source before relying on a claim. Page opening and
in-page reading depend on model support. The tool does not control a logged-in
browser, fill forms, or inherit browser cookies. The
[OpenAI web-search guide](https://developers.openai.com/api/docs/guides/tools-web-search)
describes supported actions and citations.

Set `TINKERFLEET_WEB_SEARCH=0` to disable it; `1` or an unset value enables it in
live mode. Other nonempty values are rejected. Demo mode never makes web requests.
Web search is independent of `TINKERFLEET_WORKSPACE_TOOLS` and needs no local
command approval. Queries go to the hosted provider. Keep private material out
of search requests; retrieved pages are untrusted data, not permission to act.

Search can incur tool charges in addition to model usage. The app's model-call
and token counters are not a complete tool-charge ledger or billing receipt.
See the provider's [web-search usage notes](https://developers.openai.com/api/docs/guides/tools-web-search#usage-notes)
for current terms. No paid web-search verification is implied by offline tests.

## Enable local workspace tools

For a trusted practice folder, add:

```dotenv
TINKERFLEET_WORKSPACE_TOOLS=1
TINKERFLEET_WORKSPACE=/absolute/path/to/your/practice-project
```

Restart the server after changing configuration. Choose a small, non-sensitive
folder you are prepared to modify. Bots can propose installed local tools and
create or edit files, including new files in nested folders. The bundled `examples/tiny-project` is a
practice option and contains a deliberate bug.

**Approved edits change real files in the selected folder. Approved commands run
locally with your user's permissions.** A working directory is not a sandbox:
project code can access other resources allowed to that user. The launcher does not insert a shell; an explicitly proposed shell command is
still allowed after review. Commands receive a small environment whitelist
without inherited API credentials, plus time/output limits. These measures do not provide OS isolation.

Read [workspace behavior](workspace.md) and [SECURITY.md](../SECURITY.md) before
enabling tools. Other chats using the same folder can see real changes. Chat
history separation does not isolate the filesystem.

## Keep runs small

`TINKERFLEET_REASONING_EFFORT=low` requests low reasoning effort from a compatible
model. Accepted values are `none`, `minimal`, and `low`; unset leaves the model's
default. Optional positive-integer settings can adjust these per-run limits:

| Setting | Default | Maximum |
| --- | --- | --- |
| `TINKERFLEET_MAX_MODEL_CALLS` | 12 | 64 |
| `TINKERFLEET_MAX_OUTPUT_TOKENS` | 2,048 per response | 16,384 |
| `TINKERFLEET_MAX_TOTAL_TOKENS` | 64,000 reported tokens | 1,000,000 |
| `TINKERFLEET_MAX_RUN_MS` | 120,000 ms | 600,000 ms |

Invalid settings fail startup. A response crossing a reported token threshold
has already been billed: a completed answer is retained, but subsequent calls
and exhausted-budget function work are blocked. Primary and child runs have
separate budgets and stop controls. These limits are not an overall spending cap.

Context is trimmed separately from billed usage. Recent history is bounded to
8,000 characters. Older complete turns or complete tool-call/result groups are
removed before breaking their structure; long tool output is shortened to 4,000
characters with a notice. Exact tool arguments are not truncated. The current
user input and required instructions remain intact; oversized input may fail
rather than being silently altered. Trimming does not remove saved chat history.

## What persists and what leaves the machine

Live requests can include prompts, persona instructions, bounded same-chat
history, group briefs, and—with workspace tools enabled—file content and tool
output. SDK tracing is disabled, but inference still goes to OpenAI. Consult the
[API data controls](https://platform.openai.com/docs/guides/your-data) for provider
handling.

Profiles are saved in the local server library, with migration from older browser
preferences. Private conversation views, drafts, and results
persist in `.tinkerfleet/conversations.json`; this directory is ignored by Git.
It is not encrypted or a complete secret scrubber. Keep it out of source archives.
Restart keeps history but cancels unfinished work and denies pending approvals;
raw SDK state and approval grants cannot resume. Real file changes are not undone.

The server binds to `127.0.0.1`. Keep it local; do not expose it through a tunnel.
`TINKERFLEET_PORT` selects a port from 1024 to 65535. For the built UI, run
`npm run build` followed by `npm start`. This remains a single-user teaching app.
