# Learn to build agent tools

These seven short programs walk from watching the agent loop run to approving a
real local action. Run them from the repository root with Node.js 22.12+ after `npm ci`.
They make no model requests and need no API key. Each uses assertions: a successful
run prints its explanation and exits normally; a failed assertion stops the lesson.

Read a source file, predict its result, run it, then try the suggested change.
Lessons 5 and 6 create and remove their own temporary folders. They do not edit
the example project or your selected app workspace.

## 0. Watch the loop run

```sh
npm run lesson:0
```

**Learn:** an agent is a loop. The model asks for a tool, your code runs it, the
result goes back to the model, and the model decides what to do next.

**What happens:** part A writes that loop by hand in a few lines, with a fake
model function and an `add` tool. Part B runs the same exchange through the
OpenAI Agents SDK, using its `ScriptedModel` test double in place of a real model.
The lesson checks that the tool ran exactly once and that the second model call
received the whole transcript: the user message, the tool call, and its result.
The model is stateless; it only "knows" the result because the loop sent it back.

**Expect:** `0. The loop: model asks, your code runs the tool, the result goes
back, the model answers.`

**Try:** add a second scripted `add` call before the answer. Predict
`model.calls.length` and the contents of `ran`, then update the assertions. Next,
replace `add` with a tool of your own, such as counting the words in a string.

**Source:** [00-loop.ts](00-loop.ts), then the SDK's
[running agents guide](https://openai.github.io/openai-agents-js/guides/running-agents/).

## 1. Give an agent a job

```sh
npm run lesson:1
```

**Learn:** an SDK `Agent` holds instructions and an explicit set of tools.
Constructing one does not call a model.

**What happens:** the lesson constructs Orbit through the real fleet factory,
checks that its instructions retain responsibility for the task, and verifies
that this single-agent configuration has no handoffs or tools.

**Expect:** `Primary agent: one task owner, explicit tools, zero model calls.`

**Try:** change Orbit's name and purpose. The tool count should remain zero.
What would you need to supply to give it a file-reading capability?

**Source:** [01-coordinator.ts](01-coordinator.ts), then
[`createFleetAgents` in sdk.ts](../src/server/sdk.ts).

## 2. Give individuals tools and a way to collaborate

```sh
npm run lesson:2
```

**Learn:** names and personalities describe individuals; the server determines
their capabilities. An agent can also become a callable tool through `asTool`.

**What happens:** Orbit, Ada, and Quill receive the same synthetic read and
approval-required mutation tools. The lesson checks that Orbit additionally has
`ask_ada` and `ask_quill`, and constructs an `asTool` wrapper for Ada. Neither
the synthetic tools nor any model is invoked.

**Expect:** `Ada and Quill: different personalities, the same enabled tools.`

**Try:** change Ada's purpose while keeping the supplied tools. Then remove
`mutationTools` from the factory call and predict which assertions will fail.

**Source:** [02-specialists.ts](02-specialists.ts), then
[`createFleetAgents` in sdk.ts](../src/server/sdk.ts).

## 3. Define the tool's input contract

```sh
npm run lesson:3
```

**Learn:** validation checks the shape of a request before it reaches execution.
It is separate from approving the request.

**What happens:** the app's actual validator accepts structured command and edit
proposals, returns a detached copy, and rejects file traversal, absolute paths
for the relative-path helper, a NUL character in an argument, and an unexpected
edit field. It identifies `.env` and `node_modules` as excluded paths. No files
are read and no commands are executed.

**Expect:** `Tools: accepted exact structured input; rejected file traversal,
invalid arguments, and extra fields.`

The validator deliberately accepts `sh` with `['-c', 'printf approved']`.
The active app supports installed local executables with structured arguments,
including an explicitly requested shell. This lesson does not resolve an
executable or grant approval. The native runner performs those later steps.

**Try:** add an unknown field to an otherwise valid command and assert rejection.
Change the shell script and observe that it remains valid input: what must a
person see before approving it?

**Source:** [03-tools.ts](03-tools.ts),
[runner-policy.ts](../src/server/runner-policy.ts), then
[native-runner.ts](../src/server/native-runner.ts).

## 4. Bind approval to one exact action

```sh
npm run lesson:4
```

**Learn:** an approval is a decision about a particular action in a particular
run, and can be consumed once.

**What happens:** the real `ApprovalStore` uses a deterministic clock. The lesson
tests pending, approved, consumed, denied, and expired decisions. A changed
action, different run, repeated consumption, and a new store all fail. It also
checks canonical JSON ordering and a digest that changes with the run ID.
There is no file or process execution.

**Expect:** `Approvals: pending → approved → consumed, exactly once.`

**Try:** request two actions for one run, call `invalidateRun`, and assert that
neither can be consumed. In the app, SDK interruption and resume sit around this
store; the lesson isolates the decision mechanism.

**Source:** [04-approvals.ts](04-approvals.ts), then
[approval.ts](../src/server/approval.ts).

## 5. Execute an approved local action

```sh
npm run lesson:5
```

**Learn:** the native runner connects a reviewed proposal to a real file change
or process execution.

**What happens:** in a temporary folder, the lesson first refuses an unapproved
edit and checks that the file is unchanged. It approves the edit, verifies the
new addition code, and rejects replay. It then approves creation of
`notes/results/result.txt`, including its missing parent directories, and approves
a local Node command that reads the new file. The command action is printed for
inspection. The runner shuts down and removes the fixture on exit.

**Expect:** messages confirming the real edit, nested creation, and local Node
read. The script calls `approve` itself to demonstrate the boundary; the app
presents that decision to the user.

**Try:** change the proposed file content and the corresponding assertion.
Then remove one approval and predict where execution will stop.

Commands run with the user's permissions. The selected folder is a working
directory, not an OS sandbox. `shell:false` does not prevent an explicitly
approved interpreter from accessing other resources.

**Source:** [05-local-tools.ts](05-local-tools.ts),
[native-runner.ts](../src/server/native-runner.ts), and
[the approval guide](../docs/approvals.md).

## 6. Decide what enters file context

```sh
npm run lesson:6
```

**Learn:** a workspace snapshot is a filtered view with a digest of its captured
state. It does not create an isolated copy of the project.

**What happens:** the fixture contains source, a synthetic `.env`, a dependency
folder, a symlink, and hard-linked files. Only `sum.js` enters the snapshot.
The lesson reads it, rejects excluded and traversal reads, changes its content,
and checks that a fresh snapshot has a different digest. It runs no command and
removes the temporary fixture on exit.

**Expect:** `Workspace: read allowed source, excluded hidden files, dependencies,
symlinks and hard links.`

**Try:** add a normal text file before the first snapshot and update the expected
file list. Why should a file change after review require a new approval?
Lesson 6 shows the digest change; the native-runner tests verify stale approvals
are rejected.

**Source:** [06-workspace.ts](06-workspace.ts),
[native-runner.ts](../src/server/native-runner.ts), and
[workspace behavior](../docs/workspace.md).

## Connect the pieces

Follow the [architecture walkthrough](../docs/architecture.md) to see the HTTP
app, SDK adapter, approval store, and native runner together. Use the
[tiny addition exercise](../examples/tiny-project/README.md) for a small repair
you can inspect yourself. The [testing guide](../docs/testing.md) explains which
checks use scripted responses, which perform real local execution, and what
requires a separate live-provider check.
