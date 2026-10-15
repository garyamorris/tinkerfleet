# Approvals: one decision, one exact action

Approval is an input to a paused computation, not a general permission to “do
whatever is needed.” Read the proposed change or command before deciding.

## What happens in live mode

1. A specialist requests a mutation tool with structured arguments.
2. The SDK's `needsApproval: true` interrupts execution and returns resumable state.
3. The server associates the pending interruption with an approval record.
4. The browser shows the action and its fingerprint.
5. Your decision must match the run in its conversation, pending approval, and
   unchanged action. A decision from another chat cannot authorize this action.
6. The server resumes SDK state with the decision. An approved action consumes its
   exact-action authorization before asynchronous execution begins.
7. Execution returns a result, or a bounded error, to the agent.

The model never presses the Approve button. Text in a file, tool output, or a
message cannot stand in for a verified decision from this app's user interface.

## Binding and replay

The server hashes a canonical JSON representation of the run and action, including
the runner's action binding and, for commands, resolved executable identity. Object
key order does not change this representation; a changed value does. The digest
is a fingerprint used to bind state. It is not a password or a signature that
makes a user trustworthy.

`ApprovalStore` preserves an immutable copy of the action and tracks its state:

```text
pending → approved → consumed
       ↘ denied
pending / approved → expired
```

The store's default lifetime is five minutes. Invalid, expired, denied, mismatched,
already consumed, and unknown approvals fail closed. Consuming an action is a
synchronous transition, so two racing requests cannot both start the same work.
An execution failure does not restore the spent approval. A retry is a new action
and needs a new decision.

The SDK also has its own interruption identity and approval state. Tinkerfleet's
application check does not replace the SDK pause/resume flow; both layers serve
a purpose. SDK execution state and approval authority disappear on restart;
saved conversation views do not restore them.

## What to review

For an edit, inspect the relative path, before/after text, and whether the change
matches your request. Approval writes the change to the real selected file.
It is not a disposable preview, and restart does not roll it back.

For a command, inspect the executable, every argument, working directory, and
purpose. Inspect the resolved executable path as well as its requested name.
Changing the executable after review invalidates the proposal. If it explicitly
runs a shell or interpreter, review the complete supplied script.
A harmless-looking name is not enough: `node` can execute arbitrary
JavaScript, including code loaded by an explicit test file. The process runs with
your user permissions, and its working directory does not sandbox it.

A successful command checks the files it actually received at that moment. It
does not prove the proposed change is correct, secure, or ready to ship.

## Deny, stop, restart

Denying must never execute the rejected action. Depending on the current flow,
the agent can explain the denial or the run ends. The demo intentionally stops
on denial so the outcome is easy to see. Stopping a run invalidates outstanding
approvals; a new run starts fresh. Restarting the server preserves public chat
history but cancels unfinished runs and denies their pending approvals. A saved
approval card is a historical record, not permission to resume execution.

## Demo versus live

Demo mode uses a deterministic fixture to teach the decision flow. Its edit and
command results are labeled as simulated. No SDK model inference, real file
edit, or local command execution occurs. The six no-key lessons include real approval-store assertions;
that tests application state transitions, not a live model's behavior.

Try [lesson 4](../lessons/04-approvals.ts): approve once, consume once, then prove
that replay, a changed action, and expiry all fail.
