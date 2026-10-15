# Security policy and threat model

Tinkerfleet is an educational, single-user localhost app. It is not a hardened
service for untrusted tenants or a guarantee that arbitrary code is safe.
Understand the following boundaries before enabling live mode or selecting a
workspace with real data.

## Supported trust model

The operator trusts the application source, Node process, installed dependencies,
browser origin, Docker engine, and locally available runner image. The model,
workspace contents, tool arguments, and command output may be wrong or hostile.
The operator reviews each consequential proposal. The application runs on a
machine whose other users and privileged processes are trusted.

The UI is a trusted local administration surface. Session, same-origin, and
request-token checks help resist drive-by web requests and accidental cross-origin
access. They are **not authentication against a malicious same-machine user**
who can access localhost or read/alter the running application. Do not bind the
app to a public interface or share it through a tunnel.

The default input is a validated, explicit JSON snapshot manifest. Live execution
supports Linux Docker and macOS Docker Desktop; direct directory capture remains
Linux-only. The runner uses fixed local sockets, never a remote Docker context.
Custom/rootless sockets and Windows live execution are unsupported. The macOS
connection path is implemented and unit-tested, not verified on real Mac/Docker
hardware. Demo and offline learning do not require Docker.

## Boundaries enforced by this design

- Keys remain in the server environment, never browser configuration, API output,
  an avatar setting, or a container environment. Never use `VITE_` for secrets.
- Live inference requires explicit mode and model configuration. Demo is a
  deterministic simulation with no paid model requests.
- The local server validates Host and Origin, uses an ephemeral local session,
  requires a same-origin request token for mutations, and bounds JSON requests.
- Workspace inputs are bounded and validated. Manifests contain only explicit
  relative paths and text, never links or extraction metadata. Direct Linux
  directory capture filters symlinks and sensitive paths. Traversal does not
  extend a run's scope.
- SDK mutation tools interrupt with `needsApproval: true`; saved state resumes
  only after the current decision is verified.
- Approval records bind one run to one immutable, canonical action fingerprint.
  They expire, are consumed once, and do not survive a process restart.
- Approved edits change an in-memory run snapshot only. No automatic writeback to
  the original project occurs.
- Approved commands run in a non-root Docker container with network disabled,
  read-only root filesystem, no host mounts, dropped capabilities,
  no-new-privileges, and bounded resources, duration, and output.
- The app does not fall back to running a command on the host if Docker or the
  required local image is unavailable. Image fetching is not part of a run.
- Command output is data. It is never interpreted as a patch to the source tree.
- SDK tracing is disabled. Durable conversation views exclude raw SDK state and
  approval grants; they are not a tamper-proof audit log.
- Model history is bounded and scoped to the current conversation. Each run
  receives a fresh workspace snapshot, regardless of which bot or chat starts it.

Read [workspace details](docs/workspace.md) and [approval semantics](docs/approvals.md)
for the exact implementation. A unit test of launcher flags verifies intent; only
an actual integration run exercises the local container runtime.

## Important limitations

### A container is not a separate kernel

Docker containers share the host kernel. Vulnerabilities in that kernel, Docker,
the image, or the application can defeat isolation. Non-root execution, resource
limits, and no network reduce exposure but do not prove the absence of an escape.
The Docker daemon itself is privileged on many installations. Use a dedicated,
patched development machine or stronger isolation for untrusted workloads. See
[Docker's security guidance](https://docs.docker.com/engine/security/).

The starter image uses a mutable `node:24-alpine` tag. `--pull=never` avoids an
unexpected fetch during execution; it does not prove the locally present image's
provenance. Review and pin an image digest for a more serious deployment.

### Filters do not discover every secret

A file named `notes.txt` can contain credentials. A renamed private key can evade
a filename filter. Select a small, synthetic, non-sensitive workspace first.
The app is not a data-loss prevention system or a comprehensive secret scanner.

### Live mode transmits data

Live model requests can include the task prompt, supplied or read file contents,
file names, selected persona names and purposes, bounded same-chat history, agent
messages, and tool outputs. They leave the machine for OpenAI.
Disabling tracing removes that separate trace-export path; it does not make
inference local or change the provider's retention terms. Review your account's
data controls and applicable policies before sending private content.

### Human approval has limits

A fingerprint confirms which proposal was reviewed, not that the command is
harmless. A project test can run arbitrary JavaScript. Model-written explanations
may omit a risk. The operator must inspect the actual arguments and change.
An approval is not a cryptographic identity system, permanent permission, or a
replacement for confinement.

### Resource limits are not a money guarantee

Turn, output, time, and tool limits constrain work. They do not guarantee a dollar
ceiling. Nested specialist calls, input size, provider retries/accounting, and
pricing can affect cost. Use provider-side budget controls and a small task when
you intentionally test live mode.

### Durable history does not preserve authority

The local `.tinkerfleet/conversations.json` file stores sanitized public
conversation views: chat metadata, participants, drafts, and visible run records
such as messages and artifacts. “Public” means suitable for this app's UI, not
safe to publish. It can still contain private user content. It is not encrypted,
a complete secret scrubber, a backup service, or a tamper-proof audit log. Keep
the Git-ignored `.tinkerfleet/` directory private.

Raw SDK state, approval grants, and working file snapshots are not persisted.
Restart restores history while cancelling unfinished runs and denying their
pending approvals. A new request starts a fresh run; a saved card or artifact
cannot restore execution authority. Browser reload and server restart are
different: reload can return to a still-running server task.

### Chat separation is not tenant isolation

Direct and group chats organize context. They are not separate accounts,
containers, or operating-system users. Bots share the trusted local application
process and operator. The server passes only bounded history from the current
chat to a live run; command isolation comes from the runner, not from a separate
chat window or an avatar. There is no multi-user isolation, unattended background
work, cross-chat memory system, or proactive agent routine.

## Reporting a vulnerability

Do not post credentials, private source code, real prompts, or a working exploit
against another person's service in a public issue. Use this repository's private
GitHub security advisory channel if enabled. If it is unavailable, ask a maintainer
for a private reporting route without publishing the exploit details.

Provide the affected commit, a minimal synthetic reproduction, expected boundary,
actual outcome, and relevant platform versions. Do not assume a reported issue
has been fixed until a maintainer identifies a fix. This educational project does
not promise a response SLA or production support.
