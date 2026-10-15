# Architecture: the model proposes, the harness decides

Tinkerfleet has two clearly separated routes through the same browser interface:

```text
Demo: browser → local HTTP server → scripted fixture → labeled simulated events
Live: browser → local HTTP server → selected direct agent or group orchestration
                                                   ↓
                                  validated read or proposed action
                                                   ↓
                                  human approval → bounded execution
```

The demo is an interaction example, not a fake provider placed behind the live
SDK. It lets you learn the interface and approval vocabulary without a key,
local command execution, model latency, or API spending. Prompts in demo do not produce general
intelligence: the known tiny-project request follows a scripted delegation
scenario, while a simple greeting stays in the primary chat.

## 1. The browser is a view

The React UI has a named-chat sidebar and a conversation canvas. Bot profiles,
participants, approvals, and Details belong to the selected chat and run.
It asks the server to start, inspect, stop, or decide a run. It does not hold an
OpenAI key, execute tool implementations, choose an executable outside server
policy, or decide whether an SDK tool requires approval.

Each profile contains a name, purpose/personality, color, and avatar
shape. The profile library is persisted on the local server; older browser
profiles are migrated. Creating a conversation
captures its selected profile. A direct Coordinator also captures a bounded
available-bot roster. The user-facing API creates only single-bot conversations;
a Coordinator tool creates groups with the Coordinator and selected agents.
The server validates and freezes participants. Each run
also captures its team, so later library edits do not change existing chats or
runs. Multiple conversations may independently use the same reusable bot.

In live mode, profile text guides behavior. The primary and ordinary agents
receive the same enabled workspace and web tools, with exact approval for local
edits and commands. Names such as Scout, Maker, and Checker are example
personalities. Legacy role fields are compatibility data, not tool gates.

The native Node HTTP server listens on loopback. Host/origin validation, a
session cookie, a same-origin request token, and response headers make it harder
for an unrelated website to drive the local API. These controls do not establish
an identity boundary against another user or malicious process on the same host.
Do not expose this server through a tunnel, port forward, or public reverse proxy.

## 2. Primary coordination and individual agents

The primary can perform local work directly, create named agents, send an
individual agent a message, or start a group. Ordinary agents have the same
enabled local and web tools. Only the direct primary receives the coordination
tools; a personality does not grant additional authority.

`create_agent` saves a name and purpose/personality in the local library. Up to
three creations are allowed per run and the library holds 32 profiles. Created
agents are available for direct chats and same-run coordination. Existing chat
participants stay captured rather than being rewritten by library edits.

`message_agent` sends a concise brief to an individual agent and receives its
reply through the individual conversation. A primary run can make up to three
deliveries. Only the explicit brief is shared, not private source history.

`start_group_conversation` starts one group per primary run, with up to eight
participants including the primary. Multiple ordinary agents can share similar
purposes; there is no one-per-role restriction. The group starts its own run from
an explicit brief. Source and child runs have separate budgets and stop controls;
stopping the primary does not stop an already-created child. Child groups cannot
create more groups. This is bounded collaboration, not unattended routines or
a shared memory across every chat.

The no-key demo remains scripted. It can demonstrate saving Ada's profile and
opening conversations, but does not establish live personality or collaboration.

## 3. Tools cross a trust boundary

Live conversation-only mode is the default. It supplies conversation and group
orchestration without workspace reads, edits, commands, snapshot capture, or a
execution prerequisite. `TINKERFLEET_WORKSPACE_TOOLS=1` explicitly enables
local workspace tools for an operator-selected folder. The model cannot turn that switch
on through a purpose, prompt, or tool request.

A tool request is untrusted input. Tinkerfleet checks names, argument shapes,
paths, command policy, approval identity, and bounded resources in code.
A file's contents or a command's output can also contain hostile instructions;
those are data, not permission from the person using the app.

The agents receive selected-workspace path context. File tools use relative
paths within that workspace. Native commands can accept an explicitly requested
absolute path as an argument; the working directory does not constrain the
process's OS access. Every such command still needs review and exact approval.

Read tools inspect the selected local workspace. Mutation tools propose
an exact edit or command. The edit path, new contents, executable, arguments,
working directory, and run identity matter to approval. A changed proposal needs
a new decision.

## Hosted search is separate from local tools

Live web search uses the SDK's `webSearchTool`, which supplies a hosted Responses
API tool definition to every selected agent, including the private Coordinator. Execution is provider-side, not a process in the selected
workspace. It remains available when local workspace tools are disabled unless
`TINKERFLEET_WEB_SEARCH=0`. Demo mode never invokes it. See the
[SDK hosted-tools guide](https://openai.github.io/openai-agents-js/guides/tools/).

Public search and model-supported page reading do not operate the user's browser
session. Returned sources are evidence to inspect, not trusted instructions or
authority to run commands. The app preserves validated source links with messages
for later review. Provider tool charges are distinct from local command execution
and are not fully described by a model-call count.

## 4. SDK interruption is real control flow

The live tools use SDK `needsApproval: true`. The SDK returns an interruption and
its `RunState`; the server keeps that state in memory while the browser presents
the action. After a valid decision, the server approves or rejects the interruption
and resumes the saved state. It does not simply display a confirmation card and
run the operation anyway. The [SDK approval guide](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)
explains the underlying mechanism.

Tinkerfleet adds its own exact-action, one-shot approval binding around execution.
This protects the application boundary as well as the conversation loop. See
[Approvals](approvals.md) for denial, replay, expiry, and restart behavior.

## 5. Native execution changes real files

The local runner handles approved actions in the explicitly selected workspace.
An approved edit writes a real file. An approved command is a local process,
launched with structured arguments, a minimal environment, a time limit, and
bounded output. No shell is inserted implicitly; an explicitly approved shell
can still execute its supplied script. No API key is inherited from the server environment.

The working directory is not OS isolation. Project code can access other files,
network services, and processes allowed by the user's permissions. Separate chats
using that folder can observe each other's changes. Stopping or restarting the
app cannot undo completed writes or other command effects. See
[Local workspace tools](workspace.md) and [SECURITY.md](../SECURITY.md).

## API, SDK, and managed service

These names describe different layers:

- **OpenAI API:** the remote model service. A live model request sends input to
  OpenAI and may be billed. Choosing a tool in a response does not automatically
  execute a local function.
- **OpenAI Agents SDK:** the `@openai/agents` library in this application's Node
  process. It implements agent definitions, tool execution flow, agents-as-tools,
  interruptions, and resumption. Tinkerfleet pins version 0.20.0 and supplies its
  own tools and execution boundary.
- **A managed Agents API/service:** a hosted orchestration product, with its own
  sessions, deployment, execution, and security contract. Tinkerfleet does not
  create or depend on a managed Agents API session. Installing the SDK does not
  turn this localhost server into a hosted service.

The distinction matters: neither the word “agent” nor an SDK import supplies
isolation, application authentication, secret management, or a spending cap.

## Lifetime and limits

`src/server/conversations.ts` stores visible conversation state in
`.tinkerfleet/conversations.json`. This includes chat metadata, participants,
drafts, and public run views. It excludes raw SDK state, execution grants, and
live process state. The file is private local data, not publishable
merely because its contents can be shown in the UI.

On restart, completed history remains visible. Unfinished runs become cancelled
and outstanding decisions become denied; they cannot resume. Browser reload can
return to work still active in the same server process. Legacy `{runs}` state is
migrated to one independent conversation per run.

Live history is bounded to 8,000 characters from the same chat. Outgoing context
trimming preserves complete tool-call/result groups and exact tool arguments;
long tool text is bounded to 4,000 characters with an explicit notice. The local store allows 100 conversations, 200 runs, and
8 MiB of serialized data. It is bounded local history, not an unlimited memory
or audit system. Writes are atomic; a corrupt store fails startup without being
overwritten. New store files use mode 0600 and new state directories mode 0700.

Model turns, tool work, output, and elapsed time are also bounded. These limits
do not guarantee a monetary budget. SDK tracing is disabled; live inference
still transmits profile instructions, prompts, same-chat context, relevant file
content, and tool results. Read [Setup and privacy](setup.md).

## Returning an individual agent's reply

A delegated run returns a bounded, labeled recipient reply or status to the
source primary conversation. It is visible to the primary on its next turn.
Delivery does not automatically wake the primary model, recursively trigger
other agents, or prove that requested file actions completed. Follow the
recipient's actual status and results.
