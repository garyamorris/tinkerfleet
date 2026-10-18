# Learn to build agent tools

These twelve short programs walk from watching the agent loop run to approving a
real local action, then measuring whether an agent works reading what each
model call actually saw, and comparing two runs. Run them from the repository root with Node.js 22.12+ after
`npm ci`. They make no model requests and need no API key. Each uses assertions:
a successful run prints its explanation and exits normally; a failed assertion
stops the lesson.

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

**What happens:** the lesson builds the primary agent from a profile named Orbit,
using the real fleet factory. Orbit is the profile's display name; the SDK agent
itself is always named `coordinator`. The lesson checks that its instructions
retain responsibility for the task, and that this single-agent configuration has
no tools and no handoffs. An SDK *handoff* transfers the conversation to another
agent. Tinkerfleet uses agents as tools (`asTool`, lesson 2) instead, so the
coordinator keeps control.

**Expect:** `Primary agent: one task owner, explicit tools, zero model calls.`

**Try:** change Orbit's name and purpose. The tool count should remain zero.
What would you need to supply to give it a file-reading capability?

**Source:** [01-coordinator.ts](01-coordinator.ts), then
[`createFleetAgents` in sdk/fleet.ts](../src/server/sdk/fleet.ts).

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
[`createFleetAgents` in sdk/fleet.ts](../src/server/sdk/fleet.ts).

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

**Try:** the lesson prints this exercise. Add an assertion that an edit with an
absolute path, such as `/tmp/sum.js`, is rejected. Then answer: why must an
approval for an explicit `sh -c` command show the full script?

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

## 7. Add a tool of your own

```sh
npm run lesson:7
```

**Learn:** a tool is a name, a description the model reads, an input schema, and
your code. The model only ever sees the first three.

**What happens:** the lesson defines `count_lines` and passes it to the app's real
`createFleetAgents` as a read tool. A scripted model calls it on a stand-in file.
The lesson checks that the model was offered the tool's description and JSON
Schema, that your code's result (`2`) was sent back on the next model call, and
that the agent answered with it.

**Expect:** `7. Your tool: the model saw its description and schema, and your code
did the work.`

**Try:** script a call for `missing.txt`. The tool throws: what text does the model
receive instead of a result? Then change the description and find where the model
would see it.

**Source:** [07-your-tool.ts](07-your-tool.ts), then the
[extension guide](../docs/extending.md) to add a real tool to the app.

## 8. Pause for approval through the SDK

```sh
npm run lesson:8
```

**Learn:** `needsApproval` makes the SDK stop before a tool runs and hand the
decision to your application. The run resumes from its saved state.

**What happens:** a `delete_note` tool needs approval. The lesson runs it twice.
Approved, the tool runs and the model sees its result. Rejected, the tool never
runs and the model receives the rejection message as the tool's result. Lessons 4
and 5 showed the store and runner; this is the SDK side that connects them.

**Expect:** `8. Approvals: the SDK pauses, your app decides, and the run resumes
from saved state.`

**Try:** find `result.interruptions`, `state.approve`, and `state.reject` in
[sdk/adapter.ts](../src/server/sdk/adapter.ts), and trace how the app turns them
into an approval card.

**Source:** [08-sdk-approvals.ts](08-sdk-approvals.ts).

## 9. Measure whether an agent works

```sh
npm run lesson:9
npm run eval -- --live --runs 5   # optional: your configured model, costs money
```

**Learn:** an eval gives the agent a task and grades the outcome with code the
agent cannot influence. Because a model's behavior varies, run each case several
times and look at the rate and its spread, not one result.

**What happens:** the harness in [evals/harness.ts](../evals/harness.ts) gives each
attempt a fresh copy of tiny-project and runs the agent through the app's real
adapter, approvals, and runner. The eval approves on your behalf with a narrow
policy: edits, and only the project's test command. Checks then look at the
result: the tests pass, the tests were not touched, and no other command was
requested. The lesson runs the honest scripted agent through the repair cases.
It then runs two more scripted agents against a file with a planted instruction:
one obeys it and fails, with the steps it took shown, and one ignores it and
passes. A grader that cannot fail a bad agent proves nothing.

**Expect:** `9. Evals: grade the outcome yourself, with a narrow approval policy,
over many runs.`

**Try:** add a case to [evals/cases.ts](../evals/cases.ts) that the scripted model
cannot pass, and read what the failure reports. With a live model, run
`npm run eval -- --live --runs 5 --save` for two models and compare the reports
with `--compare`. How many runs does it take for the difference to be clear?

**Source:** [09-eval.ts](09-eval.ts), then [Measure an agent with evals](../docs/evals.md)
for the full workbench.

## 10. Read a trace

```sh
npm run lesson:10
```

**Learn:** an agent has no memory between model calls. Every step sends the whole
request again, so reading a trace of what each call sent and got back is the
quickest way to understand cost, context limits, and why an agent behaved as it
did.

**What happens:** a two-step task runs through the app's real adapter with a
`TraceStore` attached. The lesson prints each call and checks three things. The
second call re-sends the first call's request and adds only the tool call and its
result. Instructions and tool definitions outweigh your question many times over.
And a long tool result is shortened before it is sent again, so the trace shows
what the model received, not what your code returned. The app's **Trace** tab
under Task details shows the same data for any run; see
[Reading a trace](../docs/traces.md).

**Expect:** `10. Trace: the model starts from nothing on every call, so each step
sends everything again.`

**Try:** add a third scripted call and predict how many items it sends and how
many are new. Then lower `maxInputChars` in the adapter's `limits` until the trace
reports `removedItems`.

**Source:** [10-trace.ts](10-trace.ts), then
[sdk/trace.ts](../src/server/sdk/trace.ts) and
[the model wrapper](../src/server/sdk/model.ts) where each call is recorded.

## 11. Compare two runs

```sh
npm run lesson:11
```

**Learn:** two runs of a model rarely say the same words, so comparing their text
is noise. A useful comparison asks where the runs first *did* something
different: which tool, with which arguments.

**What happens:** one task runs four times through the app's real adapter, each
time with a trace attached. The lesson changes one thing at a time and compares
each run with the first. The same moves in different words show no difference. A
different agent purpose shows up in the instructions while the moves stay the
same. A different file read is reported as the first call where the runs split,
with the arguments that differ. The app shows the same comparison: choose
**Compare with another task** in a task's **Trace** tab. See
[Comparing two tasks](../docs/traces.md#compare-two-tasks).

**Expect:** `11. Compare: wording varies, so ask where two runs first did something
different.`

**Try:** script the second run to call `read_file` twice and predict where the runs
diverge. Then find where `compareTraces` decides two calls are the same move, and
change what counts.

**Source:** [11-compare.ts](11-compare.ts), then
[shared/trace-diff.ts](../src/shared/trace-diff.ts).

## Connect the pieces

Follow the [architecture walkthrough](../docs/architecture.md) to see the HTTP
app, SDK adapter, approval store, and native runner together. Use the
[tiny addition exercise](../examples/tiny-project/README.md) for a small repair
you can inspect yourself. The [testing guide](../docs/testing.md) explains which
checks use scripted responses, which perform real local execution, and what
requires a separate live-provider check.
