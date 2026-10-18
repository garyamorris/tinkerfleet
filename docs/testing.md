# Test an agent app without confusing the evidence

Tinkerfleet's automated checks exercise agent configuration, SDK control flow,
HTTP requests, persistence, and local tools without a paid model call. They use
synthetic inputs and temporary files. A passing test tells you that its asserted
behavior worked; it does not establish how a remote model will respond to an
unseen prompt.

## Run the checks

From the repository root, with Node.js 22.12+ and dependencies installed:

```sh
npm run check
```

This runs TypeScript checking, the Node test suite, and the production build.
The build checks TypeScript again before Vite produces the client bundle.
HTTP tests bind local loopback ports; native-runner tests launch local processes
against temporary fixtures. Run with permissions that allow those operations.
No API key is required.

For a focused change, use the relevant command first:

```sh
node --import tsx --test tests/approval.test.ts
node --import tsx --test tests/sdk.test.ts
node --import tsx --test tests/native-runner.test.ts
node --import tsx --test tests/http.test.ts tests/memory-http.test.ts
node --import tsx --test tests/trace.test.ts tests/trace-format.test.ts tests/trace-diff.test.ts
```

Run the twelve executable lessons separately; they are not included in `npm run check`:

```sh
npm run lesson:0
npm run lesson:1
npm run lesson:2
npm run lesson:3
npm run lesson:4
npm run lesson:5
npm run lesson:6
npm run lesson:7
npm run lesson:8
npm run lesson:9
npm run lesson:10
npm run lesson:11
```

Each lesson prints the behavior it establishes and exits unsuccessfully if an
assertion fails. See the [lesson guide](../lessons/README.md) for expected results
and experiments. The deliberately broken tiny-project fixture is also separate
from the app suite: its initial failures are the [repair exercise](../examples/tiny-project/README.md).

## Know which parts are real

| Check | What runs | What the result establishes |
| --- | --- | --- |
| Validation and approval tests | Real policy functions and approval store, with controlled inputs and clocks | Accepted shapes, rejected inputs, exact action binding, expiry, and single use |
| SDK tests with `ScriptedModel` | Real Agents SDK runner, tools, nested agents, interruptions, and resume; supplied model responses | Application behavior for a known sequence of messages and tool calls |
| Native-runner tests | Real filesystem operations and, in execution tests, real local child processes in temporary fixtures | Approved writes, command results, stale-state rejection, environment filtering, and transport limits under the tested conditions |
| HTTP and persistence tests | Real local server, sessions, requests, and temporary state; demo or scripted model responses | Route validation, CSRF checks, approval ownership, conversation and memory isolation, and restart behavior |
| Client rendering tests | React rendering and client helpers | Escaping, markup, citation placement, and the tested client state transitions |
| Production build | TypeScript and Vite | Type compatibility and successful client bundling |

Some native-runner tests inject a process executor to deterministically exercise
locking or failures. Read the fixture setup before assuming a particular test
spawned a process. The [native-runner tests](../tests/native-runner.test.ts) also
include actual Node execution, process cancellation, and output limits.

## Read a scripted SDK test

[`tests/sdk.test.ts`](../tests/sdk.test.ts) imports `ScriptedModel`,
`assistantMessage`, and `functionCall` from `@openai/agents/testing`.
`ScriptedModel` supplies the next model response when the real SDK requests one.
For example, a fixture can request an edit, pause for approval, then supply a
final answer after the test approves or denies it. Assertions inspect the actual
SDK requests, interruptions, application events, and final result.

The SDK tests block outgoing `fetch` and assert that no network attempt occurred.
Reported token usage in a scripted response is synthetic data for testing budget
accounting. It is not a measurement of provider cost or model quality.

Many SDK tests use a lightweight fake workspace harness to isolate orchestration.
Others connect the SDK to `NativeWorkspaceRunner`. In
[`tests/http.test.ts`](../tests/http.test.ts), the test named “HTTP exact approvals
bind scripted SDK actions to real local edits and test execution” follows the
whole server path: scripted read and edit requests, HTTP approval, a real file
change, an approved Node test process, and the final response. The model is fake;
the approved filesystem and process operations in that fixture are real.

When adding a tool, test the outcome at its boundary: what changes before approval,
what changes after approval, and what happens on denial, replay, invalid input,
or cancellation. Add a scripted SDK test when the integration with interruptions
or tool results matters. Use temporary fixtures instead of personal projects.

## Evals: does the agent actually work?

Tests check that the application follows its own rules. An eval asks a different
question: given a real task, does the agent finish it, and does it behave? The
[eval workbench](evals.md) in `evals/` is the full tool, and
[lesson 9](../lessons/09-eval.ts) is a short tour of it. Three ideas carry over to bigger evals:

- **Grade the outcome yourself.** The grader runs the tests on its own and checks
  that the agent did not edit them. The agent's own report is not evidence.
- **Approve with a narrow policy.** An eval approves on your behalf, so it allows
  only what the task needs (here, edits in a temporary copy and the test command)
  and records anything it declined. Never auto-approve arbitrary commands.
- **Run each case several times.** Models vary. Report a score such as 5/6, and
  compare scores when you change a model, a prompt, or a tool.

`npm run lesson:9` and `npm run eval` use the scripted demo model, which checks the
harness, not a model. `npm run eval -- --live --runs 5` grades your configured model
and costs several model calls per attempt; [Measure an agent with evals](evals.md)
explains the report and how to compare two models.

## Browser checks answer different questions

A browser pass can verify that a person can find an agent, send a message, review
an approval, stop a run, follow a conversation link, and reload saved state. Check
both a wide and a narrow window for clipped controls and horizontal overflow.
Use a separate temporary state file when testing persistence so the check does
not alter someone's existing conversations.

Be explicit about the mode in your evidence:

- **Demo browser check:** exercises the real loop, tools, approvals, and a real
  test command in a temporary copy, driven by the scripted demo model. It does not
  show how a real model behaves.
- **Offline SDK browser check:** a server with an injected `ScriptedModel` exercises
  SDK-backed UI behavior. A synthetic citation can prove that a source link renders
  beside a claim; it does not prove a web search occurred.
- **Live-provider check:** exercises the configured provider with credentials and
  may incur charges. It can confirm that a specific request, tool configuration,
  or hosted search works at that time. It does not replace deterministic regressions.

The normal automated commands above do not perform that last check. Follow
[setup](setup.md) for live configuration and make the scope and expected spend
explicit before running one. Capture the mode, action, observed result, and any
limitation in a test report. A screenshot shows the rendered state; request logs,
assertions, or observed tool results establish what happened behind it.

Native commands have the user's permissions. Tests of filtered file tools,
executable identity, or cancellation do not establish OS isolation or immunity
to hostile concurrent processes. See [workspace behavior](workspace.md) and
[approval behavior](approvals.md) for the boundaries the app actually implements.
