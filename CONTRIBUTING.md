# Contributing

Tinkerfleet should remain small enough to learn from. Prefer a narrow, readable
change to a new abstraction or dependency. Explain the teaching value of a change.

## Local development

Use Node.js 24+, then `npm ci` and `npm run dev`. The server and Vite development
middleware share http://localhost:4317. Demo mode is the default. Do not put real
credentials in tests, screenshots, fixtures, issues, or pull requests.

Before proposing a change, run:

```sh
npm run check
for n in 1 2 3 4 5 6; do npm run "lesson:$n"; done
```

The loop syntax above is for a POSIX shell; on other shells run the six commands
individually. Check browser behavior separately: complete and deny a demo run,
review both edit and command approvals, stop a pending run, customize an avatar,
and inspect keyboard focus and a narrow viewport. Record the browser and viewport
used; do not describe simulated command output as an actual test execution.
Report skipped checks accurately. Offline tests must remain offline. Do not turn
on paid inference as part of a test suite. Runner tests use temporary local folders.

## Keep the boundaries obvious

- Tool names, schema validation, permissions, and approval decisions are server-owned.
- An avatar's name, color, or shape cannot grant a tool or change instructions.
- Approved edits change real files in the selected folder. Commands run as the user.
- Keep shell execution disabled, the command allowlist narrow, and the local-permission warning clear.
- Never send a key to the browser or put one in a `VITE_` environment variable.
- Keep no-key demo output clearly labeled as simulated.
- Preserve exact, expiring, single-use approval binding and fail-closed behavior.
- Update the relevant lesson and negative tests when changing a boundary.

For a bug, include Node version, operating system, mode, expected behavior, actual
behavior, and a minimal synthetic example. Redact prompts, file contents, paths,
tokens, and any other private data. A security issue belongs in a private report;
see [SECURITY.md](SECURITY.md).

## Review checklist

1. Can a beginner follow the data flow without reading an unrelated framework?
2. Are live requests, simulated output, and actual execution distinguishable?
3. Do malformed input, denial, replay, restart, and an unavailable or changed workspace fail safely?
4. Does the change preserve keyboard access, readable focus, and responsive layout?
5. Are examples original, public-safe, and free of credentials or private content?
6. Have docs and tests been updated for the exact behavior, not just the happy path?

Changes are submitted under the repository's MIT license. No contribution requires
a model call or access to a private account.
