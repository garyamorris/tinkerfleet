# Security policy and trust model

Tinkerfleet is a single-user localhost teaching app. Use trusted projects and
review every consequential action. It is not a sandbox for hostile code or a
service for untrusted tenants.

## Three modes to distinguish

- **Demo:** deterministic simulation; no model calls, real edits, or commands.
- **Live conversation:** real remote inference; workspace tools disabled by
  default. Bots can discuss supplied text and create Coordinator-led groups.
- **Live workspace tools:** explicit `TINKERFLEET_WORKSPACE_TOOLS=1` enables reads
  and approval-gated edits/commands in a selected local project.

The active app uses native local execution. Docker is not required or used.
Approved edits modify real files. Approved commands run with the user's OS
permissions. Their working directory does not restrict access to other files,
network endpoints, or processes that the user's account can reach.

## What the app enforces

The server owns tool enablement, input validation, selected workspace configuration,
and exact-action approvals. A persona's purpose cannot grant capabilities. A direct Coordinator can create
up to three named agent profiles per run;
profiles are validated and saved in the bounded local library. Creation does not
grant command authority or alter participants of existing conversations.
Approvals are expiring and single-use, bound to the run and action. Denial,
cancellation, stale state, and invalid decisions cannot authorize execution.
SDK mutation tools also pause for approval before execution.

Commands resolve from the server's PATH or an explicit absolute executable path.
Approval binds the resolved file identity, which is rechecked before execution.
The launcher uses `shell:false`; an explicitly approved shell executable can
still interpret its supplied script. The environment is limited to HOME, PATH,
TMPDIR, LANG, and configured LC_ALL/LC_CTYPE, excluding inherited server API keys.
Time and output are bounded. This does not make project
code safe. A process can read accessible credentials from disk, call the network,
or spawn subprocesses with the authority available to the user. Choose a trusted
practice folder and inspect the exact command, not just its description.

The server binds to loopback and validates Host/Origin and local mutation tokens.
These checks resist unrelated websites; they are not authentication against a
malicious process or user on the same machine. Do not expose the app publicly.

## Conversations are context boundaries

Only bounded history from the current chat supplies model context. A direct
Coordinator may create one group per run with selected agents and a bounded
brief; private source history is not copied wholesale. The group has a separate
budget and stop control. Stop it explicitly if it has already been created.

Chats do not isolate the filesystem or provide separate OS accounts. Two chats
using the same workspace can observe each other's real changes.

## Public-web research

Hosted web search is enabled by default in live mode and disabled with
`TINKERFLEET_WEB_SEARCH=0`. It is separate from native workspace tools and does
not use the user's logged-in browser or cookies. Queries are sent to the provider
and may incur additional tool charges. Keep private material out of queries.
Treat retrieved pages as untrusted input; they cannot authorize local commands,
change tool configuration, or bypass approvals. Inspect cited sources rather than treating a
search result as verified truth. Demo mode does not browse.

## Secrets, inference, and persistence

Keep API keys server-side and out of `VITE_` variables, prompts, profiles, test
fixtures, and source control. Live inference sends supplied conversation content,
profile instructions, history, and group briefs to OpenAI. With workspace tools,
file contents and command output may also be sent. Disabling SDK tracing does
not make inference local. Pattern filters are not a complete secret detector.

The private, Git-ignored `.tinkerfleet/conversations.json` stores sanitized UI
views, including drafts, messages, and artifacts. It is not encrypted or safe to
publish. It excludes raw SDK state and approval grants. Restart retains history
but cancels unfinished work and denies pending approvals. It does not undo files
already changed or effects of commands already run.

Per-run model limits are not a guaranteed monetary cap. The primary and a child
group may each consume a separate budget; provider accounting and requests that
cross a token threshold still matter.

## Reporting a vulnerability

Do not post credentials, private source, or real prompts in public issues. Use
the repository's private GitHub security advisory channel if enabled; otherwise
ask a maintainer for a private reporting route. Include a minimal synthetic
reproduction, affected commit, platform, expected boundary, and observed result.
This educational project does not promise production support or a response SLA.
