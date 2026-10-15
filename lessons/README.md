# Six runnable lessons

These lessons are small executable explanations, not slideware or partial files
that require credentials. Run them from the repository root after `npm ci`.
They use `node:assert/strict` and the actual application modules where practical.
Each process prints what it established and fails if an expected boundary changes.

All six need **no API key or model call**. Agent construction is separate from
inference. Native file/command lessons use temporary fixtures; they do not grant
permission to experiment on private projects. Docker is not required.

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

The primary owns the user's task and has coordination tools. It can also use
the same enabled local tools as ordinary agents. Personality instructions guide
behavior; the server supplies tools and enforces approvals.

**Exercise:** would changing an agent's personality grant a tool that the server
did not supply?

## 2. Agents as tools

```sh
npm run lesson:2
```

Source: [02-specialists.ts](02-specialists.ts)

Inspect how named agents can return results through an `asTool` wrapper without
invoking a remote model. Scout, Maker, and Checker are example personalities,
not fixed capability classes. Ordinary agents share enabled local/web tools.
The primary's messaging and group tools coordinate work through explicit briefs.

**Exercise:** identify the difference between a personality instruction and a
server-enforced approval before a local action.

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

## 5. Local tools

```sh
npm run lesson:5
```

Source: [05-local-tools.ts](05-local-tools.ts)

Follow the native action boundary: validate a proposal, review the exact action,
consume its approval once, and report what actually happened. Local commands run
with the user's permissions. A working directory and executable identity check
are not an OS sandbox. Keep examples in disposable temporary fixtures.

**Exercise:** explain why `shell:false` does not stop an explicitly approved
interpreter from accessing other files that the user can read.

## 6. The selected workspace

```sh
npm run lesson:6
```

Source: [06-workspace.ts](06-workspace.ts)

Inspect the selected-folder policy and distinguish conversation history from
real file state. Approved native edits persist in the selected folder; two chats
using that folder do not get isolated copies. Use synthetic temporary fixtures.

**Exercise:** explain why restarting the server invalidates an approval but does
not undo a file edit that already completed.

## From the lessons to the complete app

Read [the architecture walkthrough](../docs/architecture.md), then follow a demo
run through the UI. Finally inspect `src/server/sdk.ts`, `approval.ts`, and
`native-runner.ts` together. The important transition is from describing a request to
validating, approving, executing, and reporting that exact request.

The app's tests additionally exercise real SDK orchestration with a fake model,
including interruptions and resume. A fake model is useful for deterministic
control-flow testing; it does not validate the remote service or spend tokens.
Enabling live mode is a separate decision documented in
[setup and privacy](../docs/setup.md).
