# Local workspace tools

Live mode defaults to conversation-only. Enable tools with
`TINKERFLEET_WORKSPACE_TOOLS=1` and select a folder using
`TINKERFLEET_WORKSPACE=/absolute/path/to/project`. Docker is not used by the active
application. Start with a small, trusted practice project.

## Ask the Coordinator directly

With workspace tools enabled, the primary Coordinator can read files, create or
edit files, and run installed commands through the same exact-action approval
flow as every ordinary agent. It may use a group when collaboration helps, but
a simple local task does not require delegation. Agent names and personalities
do not change which enabled tools they receive.

## Real files and real processes

The native runner reads the selected workspace and prepares exact file or command
proposals. Approving an edit changes the real selected file or creates a new
file and its missing parent directories inside the selected folder. Approving a command
starts a local process with the selected working directory. Commands can also
modify files through project code. Changes are not automatically rolled back.

**The selected folder is a scope for the app's tools, not an OS sandbox.** A
command runs with your user's permissions and can access resources beyond its
working directory. JavaScript can open absolute paths or the network and launch
other programs. Executable identity checks do not prevent this.

The launcher passes an executable and argument vector with `shell:false`. It
does not implicitly interpret shell syntax. If a proposed command explicitly
invokes `sh` or `bash -c`, its script is part of the exact action you must review.
The process receives only `HOME`, `PATH`, `TMPDIR`, `LANG`, and configured
`LC_ALL`/`LC_CTYPE`, not arbitrary server variables or inherited API keys.
Runtime and output are bounded. These controls reduce accidental exposure; they do not isolate a hostile
program or prevent it from accessing readable files on the host.

## File paths and command paths

The file tools accept relative paths rooted in the selected workspace. For
example, `notes/plan.txt` names a file beneath that folder. This path policy does
not make the process a sandbox.

A command's `cwd` may be omitted, `.`, or a permitted existing relative
subdirectory. When the model supplies the trusted selected workspace or one of
its subdirectories as an absolute `cwd`, the SDK converts it to the corresponding
relative path before preparing approval. Outside-workspace directories and
traversal are rejected. Native path/symlink checks still apply. This normalization
does not change the approved executable or argument list.

Command arguments may contain an explicitly requested absolute path outside
the workspace. A command acting on that path runs with the user's permissions;
review its destination, executable, and arguments before approval. The app does
not promise that all machine paths are denied. Its selected working directory
remains the starting directory for the process, not an access boundary.

## Installed commands and tools

A command may name an installed executable on the server's `PATH`, such as
`python3`, `node`, or `git`, or use an absolute executable path. The server
resolves the absolute executable path before approval and binds that invocation
path and its target identity to that proposal. It checks both again before execution; a
replacement requires a new approval.

Arguments are a structured list, not a shell command line. Review the executable,
every argument, working directory, and any script passed to an interpreter.
Installed tools are not automatically safe, and tools are not installed for you.
The selected folder is still not a sandbox.

New-file edits can create nested directories after approval. Paths remain
validated; traversal and symlink paths are rejected. File replacement uses an
atomic rename, but commands can have other real effects that cannot be rolled
back. The runner serializes file and command actions within this server.

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

## Verified execution

An ordinary agent completed `git --version` and `codex --version` through the real
SDK/native runner with two exact approvals and exit code 0. Temporary-fixture
tests cover file changes and approval rejection. These checks establish the tested
paths, not that every installed tool or proposed command will work safely. See
[the handover](../HANDOVER.txt) for the full evidence and remaining limits.
