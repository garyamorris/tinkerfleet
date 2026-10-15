# Six runnable lessons

These lessons are small executable explanations, not slideware or partial files
that require credentials. Run them from the repository root after `npm ci`.
They use `node:assert/strict` and the actual application modules where practical.
Each process prints what it established and fails if an expected boundary changes.

All six need **no API key, model call, or Docker invocation**. Agents in lessons 1
and 2 are constructed but never run. Lesson 5 inspects a real launcher function.
Lesson 6 validates the real portable manifest route on every platform. On Linux
it also captures a throwaway directory and cleans it up; elsewhere it verifies
that direct directory capture fails closed. It does not pretend a mocked Docker
connection test is a real container run.

A suggested order is 1 → 2 → 3 → 4 → 5 → 6. Read the short source file, run it,
change one thing, and predict the assertion that should fail.

## 1. The coordinator

```sh
npm run lesson:1
```

Source: [01-coordinator.ts](01-coordinator.ts)

Construct the real fleet factory and inspect the coordinator's name,
instructions, tools, and absence of handoffs. Configuration is not execution:
creating an SDK `Agent` does not make an API request.

This lesson inspects the full-fleet factory, where the coordinator exposes three
named delegation tools. In the browser workflow, start by speaking to the primary
Coordinator; it may create a group with selected specialists. A direct
Coordinator's group-creation tool and a group's specialist tools serve different
steps. The coordinator owns the task and can assemble the specialists' findings instead of turning the conversation over to
whichever role answered last.

**Exercise:** find the sentence that says the coordinator retains responsibility.
Would removing it grant a specialist a new tool? Which part of the program would
actually need to change for that to happen?

## 2. Specialists as tools

```sh
npm run lesson:2
```

Source: [02-specialists.ts](02-specialists.ts)

Give the actual fleet factory two synthetic tool definitions. Scout receives the
read tool; Maker and Checker receive both. Inspect a real `asTool` wrapper without
invoking it. The wrapper is the mechanism that lets a specialist return a result
to its caller. The tools used in this lesson never touch a workspace.

An agent name is a label, and instructions describe behavior. The server's tool
assignment is what grants the concrete capability. An avatar setting cannot
change that assignment.

**Exercise:** remove the action tool from Checker. Inspect its resulting tool
list. Then change its display name in the UI. Explain why the second change has
no effect on its server-side capabilities.

## 3. Tool contracts

```sh
npm run lesson:3
```

Source: [03-tools.ts](03-tools.ts)

Use the real runner validator on ordinary JSON. It accepts a supported command,
returns a detached copy, and rejects traversal, hidden paths, arbitrary shell
execution, dependency installation, and an unexpected edit field.

Validation answers “is this a well-formed supported request?” It does not answer
“did a person approve it?” or “is arbitrary code safe?” A valid `node --test`
request still runs project code and still needs confinement.

**Exercise:** add assertions for `../../outside.js`, an absolute edit path, a
command argument containing a newline, and a binary edit. Keep the commands
unexecuted. Which layer rejects each input?

## 4. Human approvals

```sh
npm run lesson:4
```

Source: [04-approvals.ts](04-approvals.ts)

Exercise the real `ApprovalStore` with a deterministic clock. A request is
pending, approval makes it eligible, and consumption spends it once. A changed
action or another run cannot consume the decision. Denial, expiry, replay, and a
fresh process-equivalent store all reject execution.

The canonical digest is stable across object-key order, but changes when the run
or action values change. This is exact-action binding, not identity proof.
The full live integration also pauses and resumes actual SDK `RunState`; this
lesson isolates the application-level decision mechanism.

**Exercise:** prepare two actions in one run, call `invalidateRun`, and assert that
neither can be used. Why must consumption happen before awaiting a process launch?

## 5. The execution boundary

```sh
npm run lesson:5
```

Source: [05-sandbox.ts](05-sandbox.ts)

Inspect the same pure `buildDockerCreateArgs` function used by the runner.
Assertions check no network, a non-root UID, a read-only root filesystem, no
host mounts, resource limits, and a resolved local image ID. The lesson never
starts a Docker process and uses a clearly synthetic image ID.

The launcher plan is a contract. Its assertions cannot demonstrate actual kernel
isolation, a working Docker daemon, or successful container cleanup on this
machine. Tests must be honest about the boundary they actually exercise.

**Exercise:** find the tmpfs settings. Why can Node interpret a JavaScript file
on a `noexec` filesystem? Why does an executable allowlist not replace isolation?

## 6. The workspace snapshot

```sh
npm run lesson:6
```

Source: [06-workspace.ts](06-workspace.ts)

Validate an explicit JSON manifest using the real parser. Reject traversal,
duplicates, link metadata, hidden files, and file/directory conflicts. Build a
runner from a valid manifest and verify its file list and contents. The parser
copies and freezes input, so changing the original object cannot change a run.
This is the portable route used by the default bundled workspace.

On Linux, the lesson also creates a synthetic project containing a source file,
hidden environment file, dependency directory, and symlink. Capture it, change
the temporary source, and prove the existing run keeps its captured view while
a new run sees the update. Outside Linux it asserts that direct directory capture
fails closed. An injected executor throws if any process is accidentally launched.

**Exercise:** add a binary file and a multiply-linked file to the Linux fixture;
assert that both are excluded. For the manifest, add an oversized entry or duplicate
path and check the error. Always use synthetic input rather than secrets.

## From the lessons to the complete app

Read [the architecture walkthrough](../docs/architecture.md), then follow a demo
run through the UI. Finally inspect `src/server/sdk.ts`, `approval.ts`, and
`runner.ts` together. The important transition is from describing a request to
validating, approving, executing, and reporting that exact request.

The app's tests additionally exercise real SDK orchestration with a fake model,
including interruptions and resume. A fake model is useful for deterministic
control-flow testing; it does not validate the remote service or spend tokens.
Enabling live mode is a separate decision documented in
[setup and privacy](../docs/setup.md).
