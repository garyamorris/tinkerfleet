# How an agent action becomes an approved operation

A model can propose an operation; it cannot manufacture your approval. Tinkerfleet turns a proposed file edit or command into a concrete card, pauses execution, and binds your decision to that exact action.

This mechanism lets an agent move from conversation to useful work while leaving consequential local operations reviewable. The primary and ordinary agents use the same approval path. Delegating an action does not bypass it.

## Follow one edit

Suppose you ask an agent to create a short note. It calls `edit_file` with structured arguments:

```json
{"path":"notes/plan.txt","content":"Check the failing test first.\n"}
```

That is a proposal. The actual path is relative to the selected workspace; there is no implicit write just because the model emitted JSON.

```text
tool proposal → SDK interruption → prepared action + digest → review card
             → exact decision → SDK resume → consume once → execute → result
```

1. **Propose.** The model selects `edit_file` or `run_command` and supplies arguments matching the tool schema.
2. **Interrupt.** The SDK tool declares `needsApproval: true`. The run returns an interruption instead of executing the mutation.
3. **Prepare.** The server validates the request. The native runner binds it to the selected workspace, its current included-file digest, and policy version. A command also binds its resolved executable path and target identity. `ApprovalStore` keeps an immutable copy and computes the action fingerprint.
4. **Review.** The UI displays the exact edit or command. An edit includes before/after text; a command includes its executable, argument list, working directory, and resolved tool identity.
5. **Decide.** The authenticated API checks conversation ownership, run, pending approval ID, digest, and an explicit approve/deny value. The SDK is resumed with that decision.
6. **Consume and execute.** The runner checks that the workspace and executable still match the prepared proposal. The approval is consumed synchronously before the real action starts, so two racing requests cannot both use it. The runner executes the copy of the action it stored at step 3, never arguments the model sends again.
7. **Return a result.** The tool reports completion, failure, cancellation, timeout, or output limit to the agent. A tool finishing is not itself proof that the requested task succeeded.

## Who checks what

Four pieces of code take part. Each has one job:

| Layer | Its job | Code |
| --- | --- | --- |
| HTTP route | Rejects a decision for a card that is no longer pending or whose digest differs, and marks the card decided before resuming, so a double click cannot submit twice | [app.ts](../src/server/app.ts) |
| SDK adapter | Remembers which paused tool call each approval belongs to, resumes the SDK run with the decision, and lets that one call execute once | [sdk/adapter.ts](../src/server/sdk/adapter.ts), [sdk/run-fleet.ts](../src/server/sdk/run-fleet.ts) |
| `ApprovalStore` | Holds the decision: bound to the run and the action's digest, expiring, and consumable once | [approval.ts](../src/server/approval.ts) |
| Native runner | Executes its own stored copy of the approved action after re-checking the workspace digest and the executable | [native-runner.ts](../src/server/native-runner.ts) |

The last two are the authority. The first two keep the conversation and the interface in step with them.

## A command is an executable plus arguments

This `run_command` request runs an installed Node executable with one explicit test file:

```json
{"executable":"node","args":["--test","sum.test.js"],"cwd":"."}
```

The launcher does not silently run a shell around this request. A pipe character inside an argument is just an argument. A request that explicitly names `sh` with `-c` is different: the supplied script really will be interpreted by that shell after approval.

Review what the program will execute, including project code and scripts it loads. Installed programs are not inherently safe. An approved command runs with your user permissions, can access paths beyond its starting folder, and may have network or other host effects. See [workspace tools](workspace.md).

## Why the digest and state machine matter

The digest fingerprints canonical JSON containing the run and bound action. Object-key order does not change it; a changed value does. It is an action-binding mechanism, not a password or a cryptographic signature proving who a person is. Authentication and conversation ownership are separate checks.

```text
pending → approved → consumed
        ↘ denied
pending / approved → expired
```

An approval expires after a few minutes ([Limits](capabilities.md#limits)). An expired, denied, changed, consumed, or unknown approval cannot execute. Replacing a command executable or changing an included workspace file after review also invalidates the prepared action. Excluded files, such as `.env` and `node_modules`, are not part of the digest, so the approval does not cover them; see [SECURITY.md](../SECURITY.md#files-commands-and-approvals). Request a fresh proposal rather than reusing an old card.

An approval stays spent if execution fails. A retry is another operation and needs another decision. The SDK interruption state and application approval record complement each other: the SDK pauses model execution, while the application binds the concrete local effect.

## Deny, stop, and restart

Denying does not perform the rejected action. Stopping invalidates outstanding approvals and asks the runner to stop current work. It cannot undo completed edits or effects a command already caused.

Restart preserves saved chat views but cancels unfinished runs and invalidates their approvals. SDK execution state and executable approval authority are held in memory; a historical card on disk is not a resumable permission grant.

Read/list operations, hosted search, profile creation, coordination, and memory tools do not use this local-mutation approval card. Their scope is enforced by their own server tools. This is a deliberately chosen policy, not a claim that every action has the same risk. Because file reads and web search both run without a card, untrusted text in a file or page could steer the model into leaking workspace content through a search; see [Untrusted text and web search](../SECURITY.md#untrusted-text-and-web-search).

## Try the mechanism without a paid call

```sh
npm run lesson:4
npm run lesson:5
```

[Lesson 4](../lessons/04-approvals.ts) proves that an approval can be consumed once and that replay, changed actions, and expiry fail. [Lesson 5](../lessons/05-local-tools.ts) connects that approval to a real edit and command in a temporary folder. In the demo UI, the same approve/deny interaction controls only a simulated fixture.

When adding a tool to your own agent app, decide which effects need review. Keep authorization outside model-generated text, bind the decision to immutable arguments, consume it once, and test the paths that must refuse execution. The relevant regressions are in [approval tests](../tests/approval.test.ts), [native-runner tests](../tests/native-runner.test.ts), and [HTTP integration tests](../tests/http.test.ts).
