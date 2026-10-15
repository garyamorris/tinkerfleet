# Workspace snapshots and the execution boundary

There are three different places to keep straight:

1. **Input source:** an explicit JSON snapshot manifest, or a Linux project directory.
2. **Run snapshot:** a validated, bounded in-memory copy captured for one run.
3. **Command workspace:** a disposable copy of that snapshot inside a container.

The server defaults to `examples/tiny-project.snapshot.json`. An operator can set
`TINKERFLEET_SNAPSHOT` to another manifest, or `TINKERFLEET_WORKSPACE` for Linux-only
direct-directory capture. Choose one. The browser cannot select arbitrary paths.

The source is never mounted in the container. Approved edits change the run
snapshot only after successful isolated execution and confirmed cleanup. Ordinary
command writes stay in the disposable command workspace and are never imported
back. Review and apply a final change yourself if you want to keep it in your
project. Editing a source file also does not automatically update a manifest.

## Supported platforms

The **portable manifest** route supports Linux Docker and macOS Docker Desktop
without traversing a host project directory. **Direct directory capture** still
requires Linux: it uses `/proc/self/fd` and directory-descriptor-anchored reads,
rather than a string-prefix or check-then-open symlink test. Other platforms reject
that capture path; they do not receive a weaker filesystem fallback.

The Docker connection is explicit and local:

- Linux: Docker CLI with `unix:///var/run/docker.sock`
- macOS: `/Applications/Docker.app/Contents/Resources/bin/docker` with the current
  user's `~/.docker/run/docker.sock`

Remote engines, arbitrary Docker contexts, custom/rootless sockets, and Windows
live execution are unsupported. Do not forward a remote socket or add host mounts
to bypass this policy. The macOS route is implemented and covered by offline
connection/manifest tests, but has **not been tested on real Mac/Docker hardware**.
The no-key lessons and demo do not need Docker.

## Portable snapshot manifests

A manifest is JSON data containing version 1 and a list of exact relative paths
with their text content. It is not a ZIP/TAR archive, a directory path, a request
to follow symlinks, or permission to read files named by its entries.

```json
{
  "version": 1,
  "files": [
    { "path": "sum.js", "content": "export const sum = (a, b) => a - b;\n" }
  ]
}
```

Only `version` and `files` are allowed at the top level; each entry has only `path`
and `content`. Unknown metadata, links, duplicate paths, file/directory conflicts,
traversal, hidden/credential-like names, unsupported extensions, NUL data, likely
credentials, and size-limit violations are rejected. Invalid manifests are not
partially imported. Parsed data is detached and frozen before use.

The bundled manifest contains the four public tiny-project files. To supply a
custom one, explicitly choose and review each file's text, create the manifest,
and set `TINKERFLEET_SNAPSHOT` to its path in the server environment. The app reads
that operator-chosen manifest file; file-entry paths name only future container
files. No other host source file is opened because an entry mentions it.

Manifest data can still contain sensitive content that pattern checks miss.
Review it before a live run. A model can receive permitted file contents just as
it can with direct directory capture.

## What enters a direct directory snapshot

The source must be a specific real project directory, not the filesystem root,
home directory, broad temporary/workspace roots, a system/credential path, or a
symlinked directory. Individual paths must be bounded relative names without
traversal, hidden segments, backslashes, or special path syntax.

The filter excludes:

- All hidden files and directories, including `.git`, `.env`, and `.env.example`
- Dependencies and output directories such as `node_modules`, `vendor`, `dist`,
  `build`, `coverage`, and `__pycache__`
- Credential-like filenames/directories and key, certificate, database, and log
  extensions
- Symlinks, nonregular files, and files with more than one hard link
- Unapproved extensions, NUL-containing/binary data, and malformed UTF-8
- Some common private-key and API-token patterns in content

Allowed text extensions cover common JavaScript/TypeScript, JSON, Markdown,
plain text, CSS, HTML, YAML, TOML, CSV, and SVG files. This is intentionally
restrictive. It is not a complete secret detector. A sensitive sentence in an
ordinary `.txt` file may pass; select a non-sensitive project.

Direct capture checks file identity and changes during reads. It is a per-file
bounded snapshot, not a transactionally consistent filesystem snapshot across
an actively changing repository. Stop concurrent writes for reproducible inputs.

## Concrete limits

| Resource | Current limit |
| --- | --- |
| Serialized manifest input | 16 MiB |
| Files per snapshot | 256 |
| One text file | 256 KiB |
| Total snapshot text | 2 MiB |
| Directory entries visited | 4,096 |
| Directory nesting | 12 levels |
| Retained runner snapshots | 32 |
| Container command time | 15 seconds |
| Combined stdout and stderr | 64 KiB |
| Container memory / swap ceiling | 128 MiB / 128 MiB |
| Container CPU / processes | 0.5 CPU / 64 PIDs |
| Workspace tmpfs / temporary tmpfs | 32 MiB / 16 MiB |

The live SDK has additional, sometimes smaller input and tool-output limits.
A file that fits the snapshot may still be too large for a single model/tool
exchange. See `DEFAULT_SDK_LIMITS` in `src/server/sdk.ts`.

## How a command is launched

Before creating an approval, the runner resolves the already-present
`node:24-alpine` tag to a local image ID and binds that ID to the action. Execution
rechecks and uses that same ID. It uses `--pull=never`, a fixed trusted Node launcher, and structured JSON on stdin.
The launcher writes the copied files into tmpfs, then uses an executable plus
argument vector, without a host shell.

The container uses UID/GID 65532, `--network=none`, a read-only root, no host
mounts, no added capabilities, no-new-privileges, private namespaces, disabled
container logging, bounded memory/CPU/PIDs/file descriptors/file size, and
temporary filesystems with `noexec,nosuid,nodev`. The API key and host process
environment are not forwarded. See the [Docker run reference](https://docs.docker.com/engine/containers/run/)
for the underlying options.

Allowed command forms are deliberately narrow:

- `node --version`
- `node FILE.js`, `node --test [FILES]`, or `node --check FILE`
- `npm test` or `npm run test`
- `ls [PATHS]` and `cat PATHS`

These commands can still execute project-defined code. In particular, Node can
interpret JavaScript from a `noexec` filesystem, and npm scripts may spawn
subprocesses inside the container. The executable allowlist is not the sandbox.

Missing Docker, missing local image, invalid input, stale approval, changed
snapshot, cancellation, excessive output, timeout, or unconfirmed cleanup cannot
be silently turned into success. There is no host-shell fallback. If cleanup
cannot be confirmed, further execution is blocked until the operator inspects
Docker and restarts the server.

## Approval includes the snapshot

The runner binds the action to its run, current snapshot digest, selected image
reference, resolved immutable image ID, and policy version. Preparing an action
performs read-only Docker/image probes; it does not execute project code. A pending action becomes stale when an approved
edit changes the snapshot. The user must review a new action against that new
state. One accepted decision is consumed before any process begins.

A local image tag is mutable; the approval freezes the resolved image ID, so
retargeting the tag cannot silently change the approved image. If the image was
unavailable when prepared, that action cannot execute after setup without a new
approval. For serious use, configure a reviewed image digest instead of trusting
an unreviewed tag in the first place. See [SECURITY.md](../SECURITY.md) for container and image limitations.

## What this does not prove

A container shares a kernel. A patched system, a trusted Docker installation,
and careful review still matter. Unit tests and launcher inspection do not prove
a real Docker invocation succeeded. Demo output is simulated. Keep those facts
visible when describing results to somebody else.
