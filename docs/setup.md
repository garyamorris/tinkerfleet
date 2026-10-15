# Setup and privacy

## Start with the no-key demo

Requirements: Node.js 24+ and npm. Docker and an API account are optional and are
not needed for the demo or lessons.

```sh
npm ci
npm run dev
```

Open http://localhost:4317. Keep the server on localhost. `npm ci` installs the
locked dependencies; it is distinct from the app's runtime behavior and normally
requires package-registry access.

Demo mode uses a scripted tiny-project scenario. It cannot answer an arbitrary
coding question. It makes no model requests and has zero API spend. Its outputs
are labeled simulated, so an apparent test pass does not claim a command ran.

## Learn before using live inference

```sh
npm run lesson:1
npm run lesson:2
npm run lesson:3
npm run lesson:4
npm run lesson:5
npm run lesson:6
```

These lessons construct agents, inspect schemas, exercise approvals, inspect a
container plan, and validate a portable manifest. On Linux, lesson 6 also reads a
temporary synthetic workspace. They do not invoke a
remote model, Docker, or your real project.

## Opt into live mode deliberately

Live mode needs an OpenAI API key and a tool-capable model available to your API
account. API use can incur charges. An app subscription does not establish this
project's API credentials or budget.

Keep the key on the server. Do not paste it into the browser, chat prompts, a
screenshot, a public issue, or a `VITE_` variable. This repository never contains
a working key and does not retrieve credentials from another application.

Use a private environment file if that suits your local setup:

```sh
cp .env.example .env.local
```

Edit `.env.local` yourself:

```dotenv
TINKERFLEET_MODE=live
TINKERFLEET_MODEL=your-tool-capable-model-id
OPENAI_API_KEY=your-own-key
```

Then explicitly load it into the Node server:

```sh
node --env-file=.env.local --import tsx src/server/index.ts
```

The example values are placeholders, not a usable model or credential. Keep
`.env.local` private and verify it is ignored before committing. Existing process
environment variables take precedence when using Node's `--env-file`. You can
instead supply those variables through your normal secret-management workflow.
The UI never asks you to enter a key.

The default workspace is the bundled `examples/tiny-project.snapshot.json`: an
explicit JSON list of file paths and text content, validated before use. It works
without traversing a host project directory. To choose another reviewed manifest,
set `TINKERFLEET_SNAPSHOT=/absolute/path/to/project.snapshot.json` and restart.
See [the manifest format](workspace.md#portable-snapshot-manifests).

On Linux, you can instead set `TINKERFLEET_WORKSPACE=/absolute/path/to/project`
for secure direct-directory capture. Use one source setting, not both. The UI
cannot expand this scope. Relative paths are resolved from the server's launch
directory. Avoid home directories and projects containing private data.

The server binds only to `127.0.0.1`. `TINKERFLEET_PORT` optionally selects a port
from 1024 to 65535 (default 4317); open the corresponding `localhost` or
`127.0.0.1` address. Do not use a public bind or tunnel.

Use a small public or synthetic workspace for the first live task. Set provider
budget controls yourself. Bounded turns and output are not an exact cost limit.
No live call is needed to build, test, or contribute to Tinkerfleet.

## Prepare Docker only if you want real commands

The portable manifest path supports **Linux Docker and macOS Docker Desktop**.
Direct directory capture with `TINKERFLEET_WORKSPACE` still requires Linux.
The app uses fixed local connection paths:

- Linux: Docker CLI and `unix:///var/run/docker.sock`
- macOS: `/Applications/Docker.app/Contents/Resources/bin/docker` and the current
  user's `~/.docker/run/docker.sock`

Remote Docker, arbitrary contexts, custom/rootless sockets, and Windows live
execution are unsupported. The macOS connection and manifest path are implemented
and covered by offline tests; no real Mac/Docker execution has been verified for
this version. A passing mock is not a hardware integration test.

A live read or proposal is different from executing code. Applying approved edits
and executing approved commands both require a working supported Docker engine
and a local `node:24-alpine` image. The app checks Docker, the image, model/key
configuration, and secure snapshot capture before starting any live model run.
Install Docker from its official source and review the security implications of
running the daemon. Prepare the image yourself before a run:

```sh
docker pull node:24-alpine
```

This command downloads software and uses network access. Tinkerfleet does not run
it for you. During execution, the runner uses `--pull=never`; if the image is
missing, it fails rather than fetching anything or falling back to the host shell.

Do not add a host-workspace mount or expose the Docker socket inside the container
to “fix” a blocked command. Offline containers cannot install dependencies from a
registry. The included tiny project requires only Node's built-in test runner.

Read [Workspace and sandbox](workspace.md) for isolation and limits, and
[SECURITY.md](../SECURITY.md) for the remaining risks.

## What data goes where

| Mode or component | Data behavior |
| --- | --- |
| No-key demo | Scripted prompts/events are handled locally; no model or trace export |
| No-key lessons | Local synthetic fixtures and assertions; no remote inference |
| Live model | Prompts, selected profile names and purposes, supplied/read file content, agent messages, and tool outputs can be sent to OpenAI |
| Live command | A validated manifest or filtered directory snapshot goes into a local disposable container; no API key or host environment is forwarded |
| Browser | Stores the reusable profile library locally; receives visible run information and action previews, never the model key |
| Restart | In-memory runs, snapshots, and pending decisions are discarded; browser-stored profiles remain |

Profiles are browser-local preferences, not an encrypted secret store or a cloud
account. They do not sync between browsers, and clearing site data removes them.
Keep credentials and private data out of names and purposes. The server rejects
some credential-like input; those checks cannot detect every sensitive value.
Selected profile text becomes part of live model instructions when live mode is
explicitly enabled.

Filename exclusions cannot guarantee that a workspace contains no secrets. A
harmless-looking source file can include sensitive content. Review the directory
before selecting it. SDK tracing is disabled, but live inference is still remote.
For provider data handling, consult your account controls and the current
[OpenAI API data controls documentation](https://platform.openai.com/docs/guides/your-data).

## Build and run the built UI

```sh
npm run build
npm start
```

The build typechecks the project and bundles the browser UI. The Node server runs
TypeScript through `tsx`; no API key is required for a production-build demo.
Production mode changes asset serving, not the single-user trust model. It is
still a localhost learning application.
