# Extend the app one capability at a time

Start with [Build an agent app](build-an-agent-app.md) to follow a message from the browser to an SDK agent and back. Then choose one small change whose result you can see. A different personality, a new saved preference, and a new tool are three different kinds of change.

## Exercise 1: change how a bot helps

Open **Bot library**, edit a persona, and give it a concrete purpose such as:

> Teach Python patiently. Start with a small example, explain one idea at a time, and ask what I think the code will do before revealing the answer.

Start a new conversation to use the edited profile. Existing conversations retain their captured participant profiles. A profile’s personality changes the agent’s instructions; it does not add tools or grant operating-system permissions. The primary also has tools for creating agents, messaging them, and starting a group conversation.

## Exercise 1b: give a bot only what it needs

In the same editor, the **Capabilities** boxes choose which tool groups the bot receives: web, read files, edit files, run commands, and memory. Untick **Run commands** for Maker and ask it, in a new or existing conversation, to run the tests. The change applies at once. In live mode it should say it cannot; in the trace, its request lists no `run_command` tool at all. Then tick **Web** for a bot that can read files and notice the warning: that pair is the leak path in [SECURITY.md](../SECURITY.md#untrusted-text-and-web-search).

Capabilities can only narrow what the server enables. With `TINKERFLEET_WEB_SEARCH=0`, ticking **Web** has no effect; the library shows it as off on this server. To add a new capability group, extend `CAPABILITIES` in [`src/shared/capabilities.ts`](../src/shared/capabilities.ts), give its tools to `createFleetAgents` in [`sdk/fleet.ts`](../src/server/sdk/fleet.ts), and add a test like those in [`tests/capabilities.test.ts`](../tests/capabilities.test.ts). [Lesson 12](../lessons/README.md#12-give-each-bot-only-what-it-needs) walks through the rules.

Compare two answers to the same short question. The demo is scripted, so it cannot demonstrate whether new personality instructions affect a model. Use the live app only when you intentionally want a provider request.

## Exercise 2: remember a preference

Open that bot’s **Memory** panel and save “Use short Python examples before explaining terminology.” The note belongs to this bot across its conversations; another bot has its own memory. Changing the profile does not clear the note.

In live mode, the SDK loads this bot’s saved notes and gives it `recall_memory`, `remember_memory`, and `forget_memory`. Their handlers bind the owner to the bot’s identity in server code. The model does not choose another bot’s ID. Follow [Memory](memory.md) to see the storage and prompt path, then remove the note through the panel or ask the bot to forget it. A claim that something was remembered should follow a successful tool result.

## Exercise 3: add a small read-only tool

A tool gives an agent a capability it cannot get by changing its personality. Try `text_file_stats`: it reads one permitted workspace file and returns character and nonempty-line counts.

In [`src/server/sdk/run-fleet.ts`](../src/server/sdk/run-fleet.ts), find the `buildRunFleet` function. In it, find `const readTools = workspaceToolsEnabled`. (`createFleetAgents` has a different `readTools` line; leave that one alone.) Add this entry beside `read_file`, before the array’s closing `] : []`. The module already imports `tool` and `z`, and `run`, `options`, `assertActive`, and `boundedText` are already in scope inside `buildRunFleet`.

```ts
tool({
  name: 'text_file_stats',
  description: 'Count characters and nonempty lines in a permitted workspace text file.',
  parameters: z.object({ path: z.string().min(1).max(512) }).strict(),
  execute: async ({ path }) => {
    assertActive(run);
    const text = await options.harness.readFile(run.view.runId, path);
    assertActive(run);
    return boundedText({
      characters: text.length,
      nonemptyLines: text.split(/\r\n|\r|\n/).filter(line => line.trim().length > 0).length,
    });
  },
  errorFunction: () => 'File statistics were blocked or unavailable.',
}),
```

`characters` counts JavaScript UTF-16 code units, not bytes or user-perceived letters. Naming that limitation is part of making a tool understandable.

The flow is schema → workspace read → small structured result → model response. Calling `harness.readFile` preserves the existing selected-folder, excluded-file, symlink, and size checks. Do not replace it with an unrestricted filesystem read. Placing the tool inside `readTools` keeps it disabled when workspace tools are off and makes it available to agents through the existing fleet setup.

Verify with a temporary text fixture containing `one`, a blank line, and `two`: the tool should return two nonempty lines. Also check an empty file, a missing file, and a path outside the selected workspace. Use a fake model to request the new tool and check its returned result without making a provider call; [lesson 7](../lessons/07-your-tool.ts) shows that pattern, so copy it and swap in your tool. The scripted browser demo will not discover your new SDK tool automatically.

For a polished UI exercise, add a readable activity label for `text_file_stats` in the server’s event mapping. Keep the raw tool name available in task details. The activity label should describe an observed call, not predict that the call succeeded.

## Exercise 4: understand an action before adding one

Reading a file does not modify it. An edit or command does, so it follows a different path. Trace `edit_file` or `run_command` through [`sdk/run-fleet.ts`](../src/server/sdk/run-fleet.ts), [`sdk/adapter.ts`](../src/server/sdk/adapter.ts), [`approval.ts`](../src/server/approval.ts), and [`native-runner.ts`](../src/server/native-runner.ts) before adding another mutating tool.

The SDK pauses on `needsApproval: true`. The app presents the exact proposed action, binds the decision to that run and action, and consumes the approval once before execution. An approved command includes the executable, resolved executable identity, arguments, and working directory. Changing the proposed action requires a fresh decision.

For a new action, extend the existing action schema, approval preview, canonical binding, and execution handler together. A `needsApproval` flag alone does not connect a new action to all those pieces. Test approval and denial, then a changed proposal and a replayed decision. Prefer exercising temporary files to touching a real project.

Memory updates use their own bounded, bot-scoped storage tools; they do not go through the workspace edit/command approval card. If your new capability sends a message externally, deletes data, or changes another system, decide and document its concrete authorization flow rather than treating it as a read-only helper.

## Keep the learning path connected

After a small change, explain where its input enters, where validation happens, what result returns, and what the user sees. Add the most useful regression test and update the relevant lesson or document. [Contributing](../CONTRIBUTING.md) describes the review expectations; [Security](../SECURITY.md) explains the real local-execution boundaries.
