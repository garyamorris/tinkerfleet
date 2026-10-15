# Extending Tinkerfleet

Start with the smallest capability and keep authority in code. A useful new tool
is more valuable than a bigger prompt that asks an existing tool to behave.

## Add a read-only tool

1. Define a narrow, validated input schema with explicit size limits.
2. Read through the selected-workspace policy, not an arbitrary host path.
3. Reject absolute paths, traversal, excluded files, and symlink tricks.
4. Bound the returned text and clearly label errors.
5. Add the tool only to the roles that need it.
6. Test malformed input, excluded data, oversized results, and a normal request.

A proposed `read_json_property` tool could return one key from a validated
JSON file in the selected folder. It should not accept a URL, execute a JSON expression, or silently
fall back to reading the host filesystem.

## Add an action

For a new action, validation is only the first step. Define a stable, canonical
proposal that includes everything the user is approving. Use SDK
`needsApproval: true`, preserve SDK interruption/resume, bind the application
approval to the same run and exact action, and consume it once before execution.

Changing a proposal after review must invalidate the decision. Add tests for
denial, modification, expiry, replay, cancellation, and restart. Do not let an
error path accidentally call an unapproved action.

## Customize a persona first

Use a reusable profile when the goal is a different name, avatar, or focus within
an existing role. Its purpose is passed to that role's live SDK instructions; it
does not create a tool or another role. A conversation captures its selected
participants, and each run freezes its team. See `src/server/personas.ts` for validation and `createFleetAgents` in
`src/server/sdk.ts` for instruction composition.

## Add a specialist

Give the role a concrete job, a limited tool set, and a concise output contract.
Expose it with `asTool` when it should return to the coordinator. Keep nested
model calls within the same run's limits and cancellation path. Add a visible
role only when it helps the learner understand the work; extra avatars alone
do not improve a system.

The UI's profile ID and display name are separate from the server's stable role ID.
Never deserialize a browser-supplied tool list into an agent configuration.

## Change the runner

Native tools act on real files and processes. Preserve exact approvals, path
validation, minimal process environment, shell-free launch, and time/output
limits. Test writes and commands in temporary fixtures. Never describe a working
directory or executable allowlist as an OS sandbox. A new command form can widen
what project code does with the user's permissions; update the threat model and
approval preview accordingly.

## Update the teaching trail

Update the relevant no-key lesson, tests, and docs alongside behavior. Keep real
execution distinct from fakes. Tests with a fake model can verify the SDK loop
without charging an API account; they cannot establish a real provider's model
quality, billing, availability, or data handling.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the complete check list and
[SECURITY.md](../SECURITY.md) for the supported trust model.
