# Local workspace tools

Live mode defaults to conversation-only. Enable tools with
`TINKERFLEET_WORKSPACE_TOOLS=1` and select a folder using
`TINKERFLEET_WORKSPACE=/absolute/path/to/project`. Docker is not used by the active
application. Start with a small, trusted practice project.

## Real files and real processes

The native runner reads the selected workspace and prepares exact file or command
proposals. Approving an edit changes the real selected file. Approving a command
starts a local process with the selected working directory. Commands can also
modify files through project code. Changes are not automatically rolled back.

**The selected folder is a scope for the app's tools, not an OS sandbox.** A
command runs with your user's permissions and can access resources beyond its
working directory. JavaScript can open absolute paths or the network and launch
other programs. An executable allowlist does not prevent this.

The launcher uses an executable and argument vector without a shell. It passes a
minimal environment rather than inheriting server secrets and bounds runtime and
output. These controls reduce accidental exposure; they do not isolate a hostile
program or prevent it from accessing readable files on the host.

## Supported command forms

The native runner accepts `node`, `ls`, and `cat` only. Node forms are
`node --version`, `node FILE.js`, `node --check FILE.js`, and
`node --test FILES` with explicit JavaScript file paths. `ls` accepts optional
relative paths; `cat` requires explicit relative file paths. `npm` is not a
supported runner command. Repository setup commands such as `npm ci` are separate
commands you run yourself.

## Approval and shared state

Read the exact path and change, or every command argument, before approving.
Approval belongs to one immutable action in one run and cannot be reused in
another chat. Invalid, stale, denied, expired, or consumed decisions fail closed.
See [Approvals](approvals.md).

Separate chats do not create separate folders. If two runs use the same selected
folder, real changes from one can affect the other. A saved artifact is a record
of a change, not a guarantee that the file still has those contents. Restarting
the app does not undo edits or command effects.

## Teaching limits

Demo output is simulated and changes no real files. Native-runner tests should
use temporary fixtures. A passing test suite does not establish that a live
model's requested command is safe. Read [SECURITY.md](../SECURITY.md) for the trust
model and [setup](setup.md) for the explicit opt-in.
