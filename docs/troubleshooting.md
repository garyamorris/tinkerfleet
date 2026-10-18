# Understand what went wrong

An agent app combines a browser, a local server, a model, saved state, and tools.
When something fails, first identify which layer reported it. The steps below
help you diagnose the mechanism rather than repeatedly sending the same prompt.

## The demo repeats itself or ignores my request

The no-key demo's model is a script, not a real model. It recognizes a few known
requests, including the tiny-project repair. A custom purpose can be saved there, but it
does not generate new intelligence.

Check the mode in **Workspace & safety**. Use the documented demo prompts to
learn the interaction, or follow [setup](setup.md) to connect a live model.

## The app will not start

From the repository root, check `node --version`; this project needs Node.js
22.12 or later. Run `npm ci` to install the locked dependencies. Read the first
terminal error before retrying.

If port 4317 is busy, stop the server you started earlier or set
`TINKERFLEET_PORT` to an available port between 1024 and 65535. Open that port in
your browser. Invalid configuration values also stop startup; compare them with
[the configuration reference](setup.md#configuration-reference).

## I edited the env file, but the app still uses the old settings

The Node server reads its environment only at startup. Stop the old server with
Ctrl+C, then start it again from the repository root:

```sh
npm run dev
```

`npm run dev` loads `.env.local` from the repository root, next to
`package.json`. If the terminal prints `.env.local not found. Continuing without
it.`, the file is missing or misnamed. A variable already set in your shell wins
over the same name in the file; unset it in the shell or change it there too.

Check the mode, model, and tools in **Workspace & safety**. Do not print the API
key as a diagnostic. Live mode requires `TINKERFLEET_MODE=live`, a model ID in
`TINKERFLEET_MODEL`, and a server-side `OPENAI_API_KEY`.

## Live mode is configured, but the provider rejects a request

Local readiness means the app has configuration; it does not prove account
access to the selected model or tool. Read the reported provider error. Check
that the model is available to your account and supports the requested features.
If you set reasoning effort, check that the model accepts it, or remove that
optional setting and restart.

A provider quota error differs from Tinkerfleet's own run budget. Use the next
section for a message explicitly saying the local token budget was reached.
Never paste a key into a chat or issue report.

## A run reaches a turn, token, or time limit

One user message can produce several model/tool exchanges. SDK turn and
model-call caps default to `0`, meaning no count cap. A finite configured cap
can still stop a run. Token and active-runtime budgets apply independently.

Read **Workspace & safety** and the error to identify the limit. The defaults
are in [Limits](capabilities.md#run-budgets). A completed answer that crosses a
usage threshold is retained, while further work is blocked. Review the result
and any completed actions before submitting a follow-up with a fresh budget.

Context trimming is separate: it shortens what is sent to the model while
preserving saved history and complete tool-call/result groups. Raising limits
can increase usage and does not guarantee completion. See
[run limits](setup.md#keep-runs-small).

## A local command times out

Each native command has its own short, fixed timeout
([Limits](capabilities.md#limits)). Unlimited model turns and a larger run
budget do not extend it. A long install, build, or interactive process may
therefore stop even when the agent still has budget.

Inspect the command's output and termination result. Prefer a smaller,
noninteractive check that fits the runner. Do not assume a timed-out command
made no changes, or repeatedly approve the same operation without checking its
previous effects. This timeout remains a limitation of the teaching runner.

## A bot cannot read or edit my project

By default, live mode has no workspace tools. Set
`TINKERFLEET_WORKSPACE_TOOLS=1`, select a practice folder with
`TINKERFLEET_WORKSPACE`, and restart. Check the selected path and tool availability
in **Workspace & safety**. An unavailable folder prevents execution.

Each bot gets only the capabilities its profile chooses. Open **Bot library →
Edit** and check **Read files**, **Edit files**, and **Run commands**; the chat
header shows what each participant can do now. Renaming a bot or changing its
personality cannot turn tools on, and no profile can turn on what the server
disables. The primary can do a simple
local task itself; it does not need to delegate every edit.

File tools use paths relative to the selected root. For commands, a trusted
absolute working directory inside that root is normalized before approval;
outside directories and traversal are rejected. Command arguments are different:
they may name an explicitly requested absolute destination and operate with your
OS permissions. See [workspace behavior](workspace.md).

## A command fails before approval

Preparation checks the executable, arguments, and working directory before
showing a proposal. An installed command must be available on the server's PATH
or supplied as an absolute executable path. The server's environment may differ
from an interactive terminal.

Read the validation error, verify the tool is installed, and check the proposed
working directory. Ask for a corrected proposal. A failed preparation is not
evidence that the command ran. The app does not install missing tools for you.

## An approval is stale, or the executable changed

Approvals bind to one exact action and are single-use. Denial, expiry,
cancellation, or restart invalidates them. Command preparation also records the
resolved executable's identity; replacing that executable requires a fresh
proposal.

Review a new action instead of replaying an old decision. A failed execution
does not restore a consumed approval. [Approvals](approvals.md) explains why
this state belongs in the application rather than only in a model prompt.

## The bot does not remember something from another chat

Saved transcripts and per-bot memory are different. Live transcript context
comes from the current conversation. Open **Bots → Memory** for the intended
bot and check whether the fact is saved there.

Notes apply to that bot on its next turn across chats. Old history is not
imported automatically. Each bot has a cap on notes and characters
([Limits](capabilities.md#limits)). Remove obsolete notes if the store is full.
In demo mode, you can verify saved notes without expecting an intelligent recall
response. See [Memory](memory.md).

## A new bot is not in an existing group

Creating a bot saves a profile and creates its direct chat. It does not rewrite
the participants captured by an existing conversation. Use **Open this bot’s
chat**, or ask the primary to start a new group with that bot.

Only the direct primary has coordination tools. Bot creation per run, the
library, and group size all have caps ([Limits](capabilities.md#limits)). Check
the reported limit before retrying.

## Search did not run, or a page could not be read

Check the mode and `TINKERFLEET_WEB_SEARCH`; the demo never searches, and `0`
disables search in live mode. Ask explicitly for a public-web lookup and inspect
actual activity and sources. The model decides when to call enabled tools.

Page actions depend on model support and page accessibility. Hosted search does
not inherit your browser login, fill forms, or make private pages public. A link
in a reply alone does not prove the page was read. See
[capabilities](capabilities.md).

## History looks different after restarting

Restart preserves saved chat views but stops unfinished runs and denies their
pending approvals. It does not resume SDK execution or undo local file effects.
Submit a fresh message to continue.

If loading or saving fails, check access to `.tinkerfleet/conversations.json`
and its `.memories.json` companion. Conversation storage has caps on chats,
runs, and file size ([Limits](capabilities.md#limits)). Corrupt stores fail
startup rather than silently replacing your history: the server prints one line
saying which file could not be read and exits without changing it. Preserve a
private backup before repair; do not attach these files to a public issue.

Other startup problems are reported the same way, in one line: an invalid
setting names the variable, and a port that is already in use tells you to stop
the other program or choose another with `TINKERFLEET_PORT`.

## A reply's formatting or activity looks unexpected

Markdown is presentation, not execution. HTML stays inert, images appear as text
labels, and only HTTP(S) links are supported. Citations that cannot be placed
reliably inside formatted text remain in the source list.

Expand **Details** to inspect actual recorded steps. A start event alone does
not mean success, and missing events are not invented progress. Compare the
reported status, tool output, and real file state where relevant.

## Make a small reproduction

Try a fresh conversation with a harmless, narrow request. Note the mode, exact
error, expected behavior, and whether the failure happened before approval,
after approval, or at the provider. Remove credentials and private content before
sharing a report.

**Try it:** deny a demo action and explain why it did not execute. Then run a
lesson from [the lesson guide](../lessons/README.md) to find the same mechanism in
code. Use [Testing](testing.md) to turn a reproducible bug into a useful check.
