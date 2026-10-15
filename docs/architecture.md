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
Docker, model latency, or API spending. Prompts in demo do not produce general
intelligence: every run follows the tiny-project teaching scenario.

## 1. The browser is a view

The React UI has a named-chat sidebar and a conversation canvas. Bot profiles,
participants, approvals, and Details belong to the selected chat and run.
It asks the server to start, inspect, stop, or decide a run. It does not hold an
OpenAI key, execute tool implementations, choose an executable outside server
policy, or decide whether an SDK tool requires approval.

Each browser profile contains a name, purpose, role assignment, color, and avatar
shape. The profile library stays in browser storage. Creating a conversation
captures its selected profiles: one bot for a direct chat, or a subset of up to
four roles for a group. The server validates and freezes participants. Each run
also captures its team, so later library edits do not change existing chats or
runs. Multiple conversations may independently use the same reusable bot.

In live mode, a profile's name and purpose are added to its assigned agent's SDK
instructions. The server still selects that role's tools and applies its safety
instructions. Purpose is configurable guidance, not a capability grant. Renaming
Maker to “Administrator” or asking Scout to write files cannot add privileges.
Colors and avatar shapes affect presentation only. Demo mode records the team
but retains the deterministic teaching scenario.

The native Node HTTP server listens on loopback. Host/origin validation, a
session cookie, a same-origin request token, and response headers make it harder
for an unrelated website to drive the local API. These controls do not establish
an identity boundary against another user or malicious process on the same host.
Do not expose this server through a tunnel, port forward, or public reverse proxy.

## 2. Participants select the orchestration

A direct chat invokes its one selected SDK agent. In a group with a Coordinator,
the Coordinator can call only the selected specialists through
`agent.asTool(...)`. In a group without a Coordinator, the selected agents run
sequentially under a shared budget. No unselected specialist or hidden
Coordinator is inserted.

Agents-as-tools return to their caller; this is different from an autonomous
handoff or a proactive message between bots. See the
[SDK agents guide](https://openai.github.io/openai-agents-js/guides/agents/).
The current app does not implement mentions, reply threads, routines, or
background bot collaboration.

A role's capability comes from the server's tools. A Researcher without a write
tool cannot gain one by requesting it in a purpose or message. The model receives
bounded history from this conversation only, not other chats with the same bot.
That context separation does not create a separate account or machine.

## 3. Tools cross a trust boundary

A tool request is untrusted input. Tinkerfleet checks names, argument shapes,
paths, command policy, approval identity, and bounded resources in code.
A file's contents or a command's output can also contain hostile instructions;
those are data, not permission from the person using the app.

Read tools inspect the run's validated in-memory snapshot. Mutation tools propose
an exact edit or command. The edit path, new contents, executable, arguments,
working directory, and run identity matter to approval. A changed proposal needs
a new decision.

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

## 5. Execution is a separate component

The trusted local process validates an explicit JSON manifest of file paths and
content, or on Linux reads a selected directory into a bounded, filtered snapshot. Approved edits update that snapshot. A command receives a serialized
copy inside a fresh, constrained Docker container; it never receives a host
workspace mount, the app's environment, or the API key.

The container has no network and no writeable root filesystem. A small temporary
filesystem supports the command's disposable working copy. Only bounded output
returns to the server. Commands cannot commit their filesystem changes back to
the source directory or the in-memory snapshot. This is a useful teaching
boundary, not a claim that containers make arbitrary code perfectly safe.
See [Workspace and sandbox](workspace.md) and [SECURITY.md](../SECURITY.md).

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
working filesystem snapshots. The file is private local data, not publishable
merely because its contents can be shown in the UI.

On restart, completed history remains visible. Unfinished runs become cancelled
and outstanding decisions become denied; they cannot resume. Browser reload can
return to work still active in the same server process. Legacy `{runs}` state is
migrated to one independent conversation per run.

Live context uses at most the last 32 messages and 16,000 characters from finished
runs in the same chat. The local store allows 100 conversations, 200 runs, and
8 MiB of serialized data. It is bounded local history, not an unlimited memory
or audit system. Writes are atomic; a corrupt store fails startup without being
overwritten. New store files use mode 0600 and new state directories mode 0700.

Model turns, tool work, output, and elapsed time are also bounded. These limits
do not guarantee a monetary budget. SDK tracing is disabled; live inference
still transmits profile instructions, prompts, same-chat context, relevant file
content, and tool results. Read [Setup and privacy](setup.md).
