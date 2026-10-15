# Security and local execution

Tinkerfleet is a single-user localhost learning app. It uses native files and processes on the machine running the server. It does not provide an operating-system sandbox or isolation between untrusted users.

## What each mode does

| Mode | Model calls | Workspace effects |
| --- | --- | --- |
| Demo | None; scripted responses | Edits and command output are simulated |
| Live chat | Requests to the configured provider | Workspace tools are off by default |
| Live with workspace tools | Requests to the configured provider | Reads are enabled; edits and commands require exact approval |

`TINKERFLEET_WORKSPACE_TOOLS=1` enables local workspace tools. Docker is not part of the active execution path. Demo profile and memory controls still save local app data; “simulated” refers to model work and workspace actions, not every UI change.

## Files, commands, and approvals

The selected-folder policy constrains the dedicated file listing, read, and edit tools. It validates paths, excludes sensitive or unsupported files, checks symlinks, and bounds content. An approved edit changes a real file.

Commands have a broader boundary: they run with the server user’s operating-system permissions. Their starting directory does not restrict which other files, networks, or processes they can access. There is no fixed executable allowlist. The app can resolve an installed command through its server PATH or an explicit absolute executable path.

The command launcher uses separate executable and argument fields with `shell: false`; it does not implicitly interpret shell syntax. If the user explicitly approves a shell executable and script arguments, that shell can interpret the script. Review the actual executable and arguments, including any script or project code they invoke.

The app binds approval to the run and exact action, including a command’s resolved executable identity, and rechecks that identity before launch. Decisions expire and are single-use. Denial, cancellation, or an invalid decision does not authorize the action. SDK edits and commands also pause for approval. Time and output limits and a reduced child-process environment limit exposure, but do not remove a process’s ability to read accessible files or launch subprocesses. Server API keys are not deliberately inherited in that child environment; accessible credentials on disk remain accessible to commands run as the user.

Stopping a run does not undo completed edits or command effects. See [Workspace](docs/workspace.md) and [Approvals](docs/approvals.md) for the execution path.

## Bots, conversations, and memory

A profile’s personality does not grant new tools. Ordinary agents share the configured capabilities. The primary has additional coordination tools for creating agents, messaging them, and starting groups. A message or group brief supplies context to another conversation; it is not authorization for that agent to bypass a workspace approval.

Conversation history is scoped to its chat. Per-bot memory deliberately crosses conversations for the same bot. Memory handlers bind the owner on the server; ordinary agents cannot select another bot’s memory ID as their owner. Notes are bounded, viewable, and deletable in **Bot library → Memory**. They are model context, not privileged instructions. See [Memory](docs/memory.md) for the exact lifecycle and limits.

These are application context boundaries, not OS isolation. Chats using one folder can see each other’s real file changes. A child conversation may continue independently after it starts; use its own stop control when needed.

## Provider context and public-web tools

Live requests can include prompts, persona purposes, bounded conversation history, coordination briefs, and the replying bot’s saved memories. Workspace reads and command results may become model context when those tools are enabled. Saved memory is stored locally but is sent to the provider when used; local storage does not mean local inference. SDK tracing is disabled, but that does not prevent the inference request itself.

Hosted web search is enabled by default in live mode and can be disabled with `TINKERFLEET_WEB_SEARCH=0`. It uses provider-hosted web tools, not the user’s logged-in browser or cookies. Queries go to the provider and tool use may have additional charges. Retrieved content is untrusted input and cannot grant tool permissions or approve commands. Demo mode does not browse.

Keep credentials out of prompts, profiles, memory, and search queries. Redaction and pattern checks help with recognizable secrets; they are not a complete privacy filter. Keep API keys in server configuration, never browser bundles or `VITE_` variables.

## Local storage and server access

The Git-ignored `.tinkerfleet/conversations.json` contains saved conversations, profiles, and other public app views such as drafts and artifacts. Bot notes are stored separately in `.tinkerfleet/conversations.json.memories.json`. “Public view” means safe for this app’s browser contract, not safe to publish. Neither file is encrypted. Do not share them as debugging fixtures. Raw SDK state and approval grants are not restored from that file.

Restart preserves saved history but cancels unfinished runs and denies pending approvals. It cannot reverse previous filesystem or command effects.

The server binds to loopback and checks Host, Origin, and mutation tokens. These protect against unrelated web pages; they are not multi-user authentication or protection from a malicious local process. Do not expose this server as a public service.

Turn and model-call count limits can be disabled with zero. Token, runtime, and output budgets still apply. These are execution budgets, not guaranteed monetary caps: separate runs and child conversations can incur separate usage, and provider accounting remains authoritative.

## Report a problem privately

Use the repository’s private GitHub security advisory channel if enabled. Otherwise ask a maintainer for a private reporting route before sharing sensitive details. Include a synthetic reproduction, affected commit, platform, expected boundary, and observed behavior. Do not publish real credentials, private source, or personal conversation data. This learning project does not promise production support or a response SLA.
