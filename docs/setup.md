# Run your first agent app

Start with the demo to see the whole interaction before connecting a model.
Then enable live conversations and add local tools when you are ready. If you
want the bigger picture first, read [Build an agent app](build-an-agent-app.md).

## 1. Run the no-key demo

Install **Node.js 24 or later** and npm. In the repository root, run:

```sh
npm ci
npm run dev
```

Open **http://localhost:4317** and leave the terminal running. No Docker or API
key is needed. `npm ci` installs the versions in the lockfile; `npm run dev`
starts the Node server and serves the browser app through Vite. The terminal may
print `.env.local not found. Continuing without it.` That is expected: the demo
needs no settings file.

Talk to Orbit, the primary agent. Ask it to fix the failing tests in tiny-project,
then open its group conversation and review the proposed actions. Try denying
one action before approving another in a fresh run.

The demo replaces the language model with a small scripted one
([demo.ts](../src/server/demo.ts)). It does not call an API or search the web.
Everything around the model is real: tool calls, approvals, file edits, and the
test command, which act on a temporary copy of tiny-project deleted when the
server stops. Profiles, conversations, and memory notes use real local storage.
So you see the app's real mechanics without confusing a script with model
intelligence.

**Try it:** create a persona through **Bots**, save a sample preference in its
**Memory** panel, and reload. Notice which state survives. Follow the
[interface tour](interface.md) for the individual steps.

## 2. Connect a real model

Live mode replaces scripted answers with OpenAI model calls. Choose a
tool-capable model available to your account and supply your own API key on the
server. The browser never needs the key.

Create a local configuration file:

```sh
cp .env.example .env.local
```

Edit its live settings privately:

```dotenv
TINKERFLEET_MODE=live
TINKERFLEET_MODEL=your-model-id
OPENAI_API_KEY=your-own-key
TINKERFLEET_WORKSPACE_TOOLS=0
```

Replace `your-model-id` with a real model ID; [choosing a model](#choosing-a-model)
below suggests one. The placeholders are not usable credentials. Keep the file
out of version control; `.env.local` is covered by the repository's ignore rules.

Stop the demo server with Ctrl+C, then start it again:

```sh
npm run dev
```

`npm run dev` and `npm start` load `.env.local` automatically when the file
exists. The server reads settings only at startup, so restart after every change.
Open the app's **Workspace & safety** panel to check the model and enabled tools.
The panel never shows the key.

You can also set these values as ordinary environment variables. For the API
key, prefer `.env.local` to exporting it in your shell, and use a separate key
with a low spending limit for experiments.
[Credentials and approved commands](../SECURITY.md#credentials-and-approved-commands)
explains why.

Live conversations can create bots, delegate messages, use saved memory, and
start groups. With workspace tools off, agents have no project file or command
tools. Public web search is enabled by default; set `TINKERFLEET_WEB_SEARCH=0`
if you want to begin with just conversation. Live requests use the provider and
can incur charges.

### Choosing a model

The model must support tool calls through OpenAI's Responses API. For this app,
a low-cost model is a sensible start. At the time of writing (October 2026),
GPT-6 Luna (`gpt-6-luna`) is OpenAI's low-cost option:

```dotenv
TINKERFLEET_MODEL=gpt-6-luna
TINKERFLEET_REASONING_EFFORT=low
```

Model names change. Check the current list and exact IDs on
[OpenAI's models page](https://developers.openai.com/api/docs/models) before you
set `TINKERFLEET_MODEL`.

Tinkerfleet accepts only `none`, `minimal`, or `low` for
`TINKERFLEET_REASONING_EFFORT`. Not every model supports every level. If the
provider rejects the setting, choose another level or delete the line to use the
model's default.

### Other providers (untested)

Live mode uses OpenAI-specific features: the Responses API and hosted web search.
The `openai` client that Tinkerfleet uses reads `OPENAI_BASE_URL`. So a server
that offers a compatible Responses API **might** work if you also set
`TINKERFLEET_WEB_SEARCH=0`, because hosted web search runs only at OpenAI. The
app still needs `OPENAI_API_KEY` to be set; use the key that server expects.
Nobody has tested this path, so start with workspace tools off.

## 3. Add local tools

To let agents work on a practice project, add:

```dotenv
TINKERFLEET_WORKSPACE_TOOLS=1
TINKERFLEET_WORKSPACE=/absolute/path/to/your/practice-project
```

Restart with `npm run dev`. Choose a small folder you are
prepared to modify. If no workspace path is supplied, the server selects
`examples/tiny-project` relative to its working directory. Run the server from
the repository root so that default is predictable.

Ask a bot to read a file first. Then ask for a small edit and inspect the exact
proposal before approving. Reads return data to the model; edits and local
commands pause for your decision. Approved edits change real files. Approved
commands run with your user permissions: their working directory is **not a
sandbox**. See [capabilities](capabilities.md) for how tools become available and
[workspace behavior](workspace.md) for the execution boundary.

Web research is independent of local tools. It uses a hosted public-web tool,
not your logged-in browser or its cookies. Page-reading support depends on the
model. Check the returned sources as you would any other research. If the
project may contain untrusted text, set `TINKERFLEET_WEB_SEARCH=0` while
workspace tools are on; [SECURITY.md](../SECURITY.md#untrusted-text-and-web-search)
explains the risk.

## Configuration reference

These values are read by [the server entry point](../src/server/index.ts),
[app wiring](../src/server/app.ts), and [runtime config](../src/server/config.ts).
You do not need to set every option.

| Variable | Default | Meaning |
| --- | --- | --- |
| `TINKERFLEET_MODE` | `demo` | Set exactly `live` to use the model path |
| `TINKERFLEET_MODEL` | Unset | Model ID; required for live provider calls. See [choosing a model](#choosing-a-model) |
| `OPENAI_API_KEY` | Unset | Server-side credential for live provider calls |
| `OPENAI_BASE_URL` | OpenAI's API | Read by the `openai` client; [other servers are untested](#other-providers-untested) |
| `TINKERFLEET_PORT` | `4317` | Local port, from 1024 to 65535 |
| `TINKERFLEET_WORKSPACE_TOOLS` | Off | `1` enables local tools; `0` disables them |
| `TINKERFLEET_WORKSPACE` | `examples/tiny-project` | Selected folder, resolved from server working directory |
| `TINKERFLEET_WEB_SEARCH` | On in live mode | `0` disables; `1` enables; demo never searches |
| `TINKERFLEET_REASONING_EFFORT` | Model default | Optional `none`, `minimal`, or `low`, if the model supports it |

## Keep runs small

A *run* is the work started by one submitted message. Five settings bound each
run: `TINKERFLEET_MAX_TURNS`, `TINKERFLEET_MAX_MODEL_CALLS`,
`TINKERFLEET_MAX_OUTPUT_TOKENS`, `TINKERFLEET_MAX_TOTAL_TOKENS`, and
`TINKERFLEET_MAX_RUN_MS`. Their defaults and allowed ranges are in the
[run budgets table](capabilities.md#run-budgets). The two count limits default to
`0`, which means no cap. Token, output, and active runtime limits stay on even then.

Invalid limit settings fail startup. A completed response can cross the usage
threshold; the app keeps the answer and blocks further work. These are execution
limits, not a guaranteed spending cap. `message_agent` and
`start_group_conversation` create separate conversation runs with their own
budgets. Nested `ask_*` agent calls within a group share that group run’s
model-call, token, and runtime budgets. Stopping the primary does not stop an
already-created child conversation run.

A native command has its own fixed timeout ([Limits](capabilities.md#limits)).
Removing turn limits or raising the run budget does not extend it.

## Saved state and model context

The server saves profiles and chat views in `.tinkerfleet/conversations.json`.
Per-bot notes live in `.tinkerfleet/conversations.json.memories.json`, and
scheduled prompts in `.tinkerfleet/conversations.json.schedules.json`. All are
private local data in a Git-ignored directory. They can contain your messages,
drafts, notes, and results; do not include that directory in a shared source copy.

Live model input includes the bot's instructions, saved notes, bounded same-chat
history, and relevant tool results. The app does not automatically import old
transcripts into memory. Read [Memory](memory.md) to understand the distinction
between stored history and the context a model actually receives.

Restart keeps saved history but stops unfinished runs and denies their pending
approvals. It cannot undo a completed edit or command. Keep the server local; it
binds to `127.0.0.1` and is intended for one person learning on their own machine.

## Run the built interface

For a production frontend build:

```sh
npm run build
npm start
```

`npm start` also loads `.env.local` when it exists. To use a different file, run
the server directly, for example
`node --env-file=.env.other --import tsx src/server/index.ts --production`.

Next, follow [Build an agent app](build-an-agent-app.md), run the
[fourteen lessons](../lessons/README.md), or read [Testing](testing.md) before changing
an implementation detail.
