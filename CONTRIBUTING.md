# Contributing

Tinkerfleet is an agent app you can learn from by reading and changing it. A useful contribution makes a behavior easier to understand, demonstrates one capability clearly, or fixes a concrete problem. Prefer a small, readable change over a framework added for possible future needs.

## Get the app running

Use Node.js 22.12 or later:

```sh
npm ci
npm run dev
```

Open http://localhost:4317. The default demo needs no key and makes no provider calls. Follow [Build an agent app](docs/build-an-agent-app.md) for the code path, then [Extending](docs/extending.md) for small exercises. [Memory](docs/memory.md) covers per-bot notes.

## Make the change easy to follow

Describe the problem and the resulting behavior. A reviewer should be able to trace one example from its input to the server handler, tool or storage operation, and visible result. Explain an unfamiliar abstraction where it is introduced; avoid adding layers that obscure a short flow.

Keep examples synthetic and useful to a learner. Leave credentials, personal prompts, private file contents, and machine-specific paths out of fixtures, screenshots, issues, and pull requests. Preserve the distinction between a scripted demonstration, a fake-model integration test, and actual provider or command execution.

Profiles express personality and purpose. They do not grant tools. Tool enablement and validation remain server-owned. Memory is owned by each bot, and file edits and commands continue through their exact approval flow. If a change alters one of these behaviors, update the explanation and the tests that demonstrate it.

## Verify what changed

Run a focused test while developing. Before submitting executable changes, run the project’s combined check:

```sh
npm run check
```

It checks formatting, typechecks, runs the offline test suite, and builds the app. Run `npm run format` to apply the project’s Prettier style before committing. See [Testing](docs/testing.md) for choosing useful cases and for the distinction between fake and real execution. Tests must not silently start paid inference. Native-runner tests should use temporary folders.

Run the relevant `npm run lesson:0` through `npm run lesson:9` command when changing what a lesson teaches. For UI changes, inspect the affected flow in a browser, including keyboard focus and a narrow viewport. An approval change deserves both an approved and a declined action; a memory change deserves checking that another bot’s notes remain separate. Report what you actually checked and any limitations. Documentation-only changes need accurate examples and links, not an unrelated full test campaign.

## Send a reviewable contribution

Include the concrete before/after behavior, why it helps the app or its learning path, and the checks you ran. A short description is enough for a small fix. Keep new dependencies justified by the problem they solve.

For a bug report, include the operating system, Node version, app mode, and a small synthetic reproduction. Describe expected and actual behavior. Send security-sensitive details privately using the route in [SECURITY.md](SECURITY.md).

Contributions use the repository’s MIT license. You do not need a provider account or a paid model call to contribute.
