# Troubleshooting

## The demo repeats the same task

Demo mode is scripted around tiny-project and does not answer arbitrary coding
questions. A custom persona purpose only guides a real model in live mode. Demo
completion is not evidence of file edits or command execution.

## Startup or dependency installation fails

Use Node.js 24+ and run `npm ci` from the repository root. Keep the lockfile;
installation normally needs package-registry access. If port 4317 is occupied,
stop the previous app or set `TINKERFLEET_PORT` to an available port from 1024 to
65535. Keep the server local.

## Live chat is not ready

Set `TINKERFLEET_MODE=live`, a usable `TINKERFLEET_MODEL`, and a server-side
`OPENAI_API_KEY`. A `.env.local` file is not loaded automatically: use
`node --env-file=.env.local --import tsx src/server/index.ts`. Never print a key
to confirm it exists. Model and reasoning-effort support depend on the selected
provider model. Invalid local budget settings fail startup.

## The bot cannot read or change files

Conversation-only live mode has no workspace tools. To enable them, set
`TINKERFLEET_WORKSPACE_TOOLS=1` and select a trusted folder with
`TINKERFLEET_WORKSPACE`. Restart the server. An unavailable or invalid selected
folder fails closed. Docker is not required.

Review the selected folder before approving anything: approved edits change real
files and commands run under your user's permissions. Their working directory
is not a sandbox. A custom purpose cannot enable tools or bypass approvals.

## An approval is stale or already used

A decision applies to one exact action in one run and chat. Denial, expiry,
cancellation, or restart invalidates it. A failed action does not restore its
spent approval. Review a fresh proposal rather than replaying the old one.

## My file changed, but another chat does not mention it

File state and conversation context are different. Chats keep separate message
histories, but workspace-enabled runs use the real selected folder. Another chat
may observe a file change when it reads the folder; it does not automatically
receive the other chat's conversation or artifacts. Restart does not undo files.

## The practice project's tests fail

`examples/tiny-project` contains a deliberate addition bug. Its tests are separate
from repository checks. A demo only simulates repair. An approved live native edit
can actually repair the fixture; use a disposable copy if you want to repeat it.

## History cannot be loaded or saved

The private store is `.tinkerfleet/conversations.json`. Check access and its
limits: 100 conversations, 200 runs, and 8 MiB. Corruption stops startup rather
than replacing history. Preserve a private backup before repair; never publish
its contents. Restart restores history but stops unfinished runs and denies
pending decisions.

## A new bot is missing from an existing conversation

Creating a bot saves it in the server library and makes it available to the
Coordinator. It does not change the participants of a chat already created. Use
**Talk** on the creation message to start a direct chat, or ask the Coordinator
to include the bot in a new group. Each group can contain one specialist per
capability role.

Only a direct Coordinator can create bots. A run can create at most three, and
the library holds up to 32 profiles. In demo mode, use the exact documented
Ada example; arbitrary requests are not interpreted by a model.

## Browser verification is separate

`npm run check` checks types, Node tests, and production build. See the
[handover](../HANDOVER.txt) for browser evidence and limitations. A rendered
button alone does not prove its action completed.

## A live answer does not search or read a page

Check that `TINKERFLEET_WEB_SEARCH` is not `0`, and that the selected model supports
the hosted web-search actions you need. Ask explicitly for a current public-web
lookup and inspect any returned sources. Page opening depends on model support.
Private, authenticated, or inaccessible pages are not made accessible by this
tool. Demo mode is always scripted and performs no web requests.
