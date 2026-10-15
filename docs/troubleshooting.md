# Troubleshooting

## The demo keeps fixing the same example

That is intentional. Demo mode is a deterministic interaction lesson, not model
inference. Use the lessons to understand the building blocks. Live mode is a
separate, explicit opt-in with privacy and billing consequences.

## `npm ci` or startup fails

Check `node --version`; the project requires Node 24+. Run commands from the
repository root. `npm ci` needs access to the dependency registry and uses the
committed lockfile. Do not delete the lockfile to work around a reproducibility
problem without understanding the resulting dependency changes.

If port 4317 is already occupied, stop the previous local Tinkerfleet process or
choose another allowed local port with `TINKERFLEET_PORT` (1024–65535), then
restart. Open the exact localhost address
printed by the server. Do not disable Host or Origin checks to use another host.

## Live mode is not ready

Check the server environment, not the browser's JavaScript:

- `TINKERFLEET_MODE` must explicitly be `live`.
- `TINKERFLEET_MODEL` must be a real tool-capable model ID your account can use.
- `OPENAI_API_KEY` must be present in the server process.

A `.env.local` file is not magic. Use the documented `node --env-file=.env.local`
command or your own environment loader. Never log a key to confirm it exists.
A failed live run is not silently converted into a successful demo.

## Docker or the runner image is unavailable

The runner fails closed. Check Docker's status and prepare the documented image
yourself. No approved command should execute on the host as a fallback. If Docker
is not appropriate for this machine, keep using the no-key demo and lessons.
On macOS use the default portable manifest with Docker Desktop. Direct directory
capture is Linux-only. The app does not use remote Docker contexts or arbitrary
socket paths.

Do not infer a real container run from simulated output, a successful dependency
install, or tests that inspect launcher flags. Those verify different things.

## A command cannot install packages or reach the network

Expected: command containers have network disabled. `node_modules` is excluded
from the snapshot. The practice project uses only Node built-ins. Supporting a
new dependency environment means deliberately preparing and reviewing a runner
image, not weakening the command's network policy during a run.

## An approval is stale or already used

A decision applies to one exact pending action in one run. It cannot be replayed
or moved to a new proposal. Expiry, stopping, or a server restart invalidates the
old decision. Restart preserves chat history but cancels unfinished work and
denies pending approvals. Reload and submit a fresh task in the chat. Do not edit an action's
JSON or retry a consumed approval to force it through.

## My source file did not change

Expected. Edits affect the run's in-memory snapshot. Command files are disposable
and are not written back either. Review the proposed change and apply it yourself
if you want to keep it. This protects the original project and makes the boundary
visible while learning.

## My file does not appear in the workspace

The default source is the explicit `examples/tiny-project.snapshot.json` manifest,
not a live directory mount. Changing a source file does not update that manifest.
Review and update the manifest content, or choose Linux directory capture with
`TINKERFLEET_WORKSPACE`. An invalid manifest is rejected rather than partially
imported. The browser cannot expand the selected source.

Paths, extensions, secret-like filenames, symlinks, file count, and byte limits
restrict what can enter a snapshot. Select a small, regular-text, non-sensitive
project. Do not rename a secret to bypass a filter. See
[Workspace and sandbox](workspace.md).

## The practice project's tests fail

`examples/tiny-project` is deliberately broken. Its tests are separate from the
repository checks. The intended fix changes subtraction to addition in `sum.js`.
A successful demo only simulates that repair; it does not change the fixture.

## Browser verification is separate

`npm run check` checks TypeScript, the Node test suite, and the production build.
It does not establish browser layout, keyboard navigation, or interaction behavior.
See [the handover](../HANDOVER.txt) for recorded browser evidence and remaining
verification. Follow the manual browser checklist in
[Contributing](../CONTRIBUTING.md). A missing browser or an absent browser test
suite is not a passed UI check.

## A continued chat does not retain file edits

Conversation history and working files have different lifetimes. Each submitted
run captures a fresh workspace snapshot. Earlier changes remain visible as
artifacts but are not imported as the next run's filesystem. Review and apply
changes to your input source yourself when you want future runs to include them.

## Local history cannot be loaded or saved

The default state file is `.tinkerfleet/conversations.json`. Check that the local
process can access its private state directory and that the store is within its
limits. A corrupt store stops startup rather than silently replacing history.
Preserve a private backup before attempting repair; do not publish its contents.
The store is limited to 100 conversations, 200 runs, and 8 MiB of serialized data.
