# What Tinkerfleet can do

Tinkerfleet is a small agent application you can run, inspect, and change. A model chooses among tools supplied by the application; server code decides what those tools can actually do. An agent's personality changes its instructions. It does not grant new permissions.

This page is the reference for what each mode can do and for every numeric limit. Other documents link to [Limits](#limits) instead of repeating the numbers.

## Modes

Start with the [setup guide](setup.md). These are startup modes, not three different agent implementations:

| Capability | Demo | Live chat | Live with workspace tools |
|---|---|---|---|
| Replies | A scripted model with a few teaching examples; no API call | Real Agents SDK model calls | Real Agents SDK model calls |
| Personalities and direct chats | Saved profiles; scripted replies | Independent agents with saved profiles | Same |
| Primary coordination | Documented scripted creation, messaging, and group examples | Create agents, message registered agents, start groups | Same |
| Public web search and page reading | No | Hosted search enabled by default; model-dependent page actions | Same |
| Saved memory | Manage entries through the UI; no model deciding what to remember | Per-agent recall, remember, and forget tools | Same |
| List and read local files | A temporary copy of tiny-project | Unavailable | Permitted text files in the selected workspace |
| Create and edit files | The temporary copy, after exact approval | Unavailable | Real files, after exact approval |
| Run installed commands | The scripted test command in the temporary copy, after exact approval | Unavailable | Real local processes, after exact approval |
| Saved chat history | Yes | Yes | Yes |

Live chat is the default live configuration. `TINKERFLEET_WORKSPACE_TOOLS=1` enables local tools; `TINKERFLEET_WORKSPACE` chooses their starting folder. `TINKERFLEET_WEB_SEARCH=0` disables hosted search. Live mode requires a configured model and a server-side API key. See [configuration](setup.md) before running paid requests.

## Personalities, tools, and coordination

An ordinary agent has an ID, name, personality, and avatar. Ordinary agents receive the same enabled workspace and web tools. There are no fixed researcher, builder, or checker permission classes. Historical profiles can retain old role labels so their saved conversations remain readable.

The primary has additional coordination tools:

- `create_agent` saves a reusable personality and provides its direct-chat link. Creation itself does not ask that agent to perform a task.
- `message_agent` sends an explicit brief to a registered agent's own chat. The recipient can use its own chat history and memory. The primary's private transcript is not copied. A bounded reply or status is relayed to the primary chat and is available on its next turn; the relay does not automatically buy another model call.
- `start_group_conversation` starts a separate group with the primary and selected agents. The supplied brief is its initial context. Within a group, the primary can use the selected agents' `ask_*` tools.

The bot library holds one primary agent. Creating, editing or importing a second one is refused; a library saved before this rule that already has several still loads.

IDs, rather than names, route these operations. Two agents can have similar personalities without being the same participant. Existing conversation identities remain frozen when a library profile is edited. The library and each group have a size cap. In one run, the primary can create only a few agents, send only a few messages, and start one group; see [Limits](#limits). Exact retries reuse the recorded result.

**Trace the implementation:** [profile validation](../src/server/personas.ts), [agent construction](../src/server/sdk/fleet.ts), [SDK tools](../src/server/sdk/run-fleet.ts), [server-owned creation and delivery](../src/server/app.ts), and [saved provenance checks](../src/server/conversations.ts).

**Try it without a key:** in demo mode, ask the primary `Create a patient writing coach named Ada`, then `Ask Ada: Hello`. These are explicit scripted patterns, not general language understanding. The created profile can later be used in live mode.

## What “memory” means here

Saved memory is a small, explicit collection of entries scoped to one profile ID. The live agent can recall, save, or forget its own entries, and you can inspect and manage them in the UI. It is distinct from conversation history and from the shortened context sent in a particular model request.

Memory persists locally across restarts. It is not model training, unlimited recall, or access to another agent's private memories. Each agent has a cap on entries and characters; see [Limits](#limits). Local files are not encrypted by this application, and secret-like content is rejected rather than treated as appropriate memory.

**Trace it:** [memory storage](../src/server/memory.ts), memory tool construction in [sdk/run-fleet.ts](../src/server/sdk/run-fleet.ts), and [context budgeting](../src/server/context-budget.ts). Read [architecture](architecture.md) for the distinction between saved state and model context.

## Web access is a hosted tool

Live agents can use hosted public web search. Where the selected model supports them, page-open and find-in-page actions let it read public pages and follow relevant links. Responses can include clickable source citations. Observed tool activity is displayed; the app does not invent a search event while waiting for a model.

This is not an interactive browser. It does not provide your logged-in browser sessions, manipulate a website UI, submit forms, or guarantee access to paywalled or blocked pages. Web content is untrusted input, and a citation is a source reference rather than proof that the answer is correct. Hosted search can incur charges in addition to model usage; the displayed model-call count is not a separate search-call bill.

**Trace it:** hosted tool setup in [sdk/fleet.ts](../src/server/sdk/fleet.ts), provider events in [sdk/model.ts](../src/server/sdk/model.ts), [source validation](../src/server/sources.ts), and [citation rendering](../src/client/citations.tsx).

## Local work has real effects

With workspace tools enabled, any agent, including the primary, can propose an edit or installed command. The UI pauses that action for review. Approved edits change real files; approved commands run with the server user's OS permissions, so the starting folder does not confine them. Command arguments can refer to other host paths, and an explicitly proposed shell can run a script.

Each command has a short, fixed timeout and bounded output; see [Limits](#limits). This runner is not a persistent terminal, interactive login session, or background-job supervisor. A long build, package installation, or development server can exceed its lifetime. There is no dedicated installer tool, but an installed package manager can be proposed through the ordinary approved-command path. There is no automatic undo for effects already performed.

Read [workspace tools](workspace.md) for file-policy versus process permissions, and [approvals](approvals.md) for the decision flow.

## Limits

These are the limits in the current code. If you change one, update this table.

### Run budgets

A *run* is the work started by one submitted message. You can change these settings; [setup](setup.md#keep-runs-small) explains how they interact.

| Variable | Default | Allowed range |
| --- | --- | --- |
| `TINKERFLEET_MAX_TURNS` | `0` (no cap) | `0`, or 1–64 SDK turns |
| `TINKERFLEET_MAX_MODEL_CALLS` | `0` (no cap) | `0`, or 1–64 model calls |
| `TINKERFLEET_MAX_OUTPUT_TOKENS` | `2048` | 1–16,384 tokens per response |
| `TINKERFLEET_MAX_TOTAL_TOKENS` | `64000` | 1–1,000,000 reported tokens per run |
| `TINKERFLEET_MAX_RUN_MS` | `120000` (2 minutes) | 1–600,000 milliseconds of active runtime |

Defaults and ranges are in [config.ts](../src/server/config.ts) and `DEFAULT_SDK_LIMITS` in [sdk/contract.ts](../src/server/sdk/contract.ts).

### Fixed limits

These are not configurable. Raising a run budget does not change them.

| Area | Limit | Value | Set in |
| --- | --- | --- | --- |
| Local commands | Time per command | 15 seconds | [runner-policy.ts](../src/server/runner-policy.ts) |
| Local commands | Combined stdout and stderr returned | 64 KiB | [runner-policy.ts](../src/server/runner-policy.ts) |
| File tools | Files in one workspace capture | 256 | [runner-policy.ts](../src/server/runner-policy.ts) |
| File tools | Size of one file | 256 KiB | [runner-policy.ts](../src/server/runner-policy.ts) |
| File tools | Included text in one capture | 2 MiB | [runner-policy.ts](../src/server/runner-policy.ts) |
| Approvals | Lifetime of an approval | 5 minutes | [approval.ts](../src/server/approval.ts) |
| Approvals | A run left waiting for approval is stopped after | 10 minutes | [sdk/contract.ts](../src/server/sdk/contract.ts) |
| Model context | Recent same-chat history sent with a run | 8,000 characters | [sdk/adapter.ts](../src/server/sdk/adapter.ts) |
| Trace (per call) | Items shown, characters per item, characters of instructions, tools listed | 60, 1,500, 6,000, 48 | [sdk/trace.ts](../src/server/sdk/trace.ts) |
| Trace (per run) | Calls recorded, characters stored | 48, 1,000,000 | [sdk/trace.ts](../src/server/sdk/trace.ts) |
| Trace (all runs) | Runs kept, characters stored; memory only, oldest dropped first | 20, 8,000,000 | [sdk/trace.ts](../src/server/sdk/trace.ts) |
| Memory (per bot) | Saved notes | 20 | [memory.ts](../src/server/memory.ts) |
| Memory (per bot) | Characters in one note | 2,000 | [memory.ts](../src/server/memory.ts) |
| Memory (per bot) | Characters across all its notes | 8,000 | [memory.ts](../src/server/memory.ts) |
| Coordination (per primary run) | New bots created | 3 | [app.ts](../src/server/app.ts) |
| Coordination (per primary run) | Distinct messages sent to agents | 3 | [app.ts](../src/server/app.ts) |
| Coordination (per primary run) | Groups started | 1 | [sdk/run-fleet.ts](../src/server/sdk/run-fleet.ts) |
| Coordination | Ordinary agents in one group | 7, plus the primary | [conversations.ts](../src/server/conversations.ts) |
| Bot library | Saved profiles | 32 | [personas.ts](../src/server/personas.ts) |
| Saved conversations | Chats | 100 | [conversations.ts](../src/server/conversations.ts) |
| Saved conversations | Runs | 200 | [conversations.ts](../src/server/conversations.ts) |
| Saved conversations | Size of the store file | 8 MiB | [conversations.ts](../src/server/conversations.ts) |

## Learn one boundary at a time

Run these without a model key:

```sh
npm run lesson:3
npm run lesson:4
npm run lesson:5
```

Lesson 3 explores validated tool inputs. Lesson 4 demonstrates exact, single-use approvals. Lesson 5 makes a real approved edit and runs a local command in a temporary teaching folder, then cleans it up. The demo UI uses the same server components, driven by a scripted model.

For a new capability, follow the same path: define structured input, implement a bounded server operation, decide where approval is needed, expose the result to the model, and test rejection as well as success. Adding a tool description alone does not implement that capability.
