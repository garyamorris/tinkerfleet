# How local workspace tools work

Live workspace mode connects the agent's tools to real local files and installed programs. It uses a native process runner; Docker is not part of the active execution path.

Enable it with `TINKERFLEET_WORKSPACE_TOOLS=1` and select a small practice folder with `TINKERFLEET_WORKSPACE=/absolute/path/to/project`. The default selected folder is the included tiny-project example. Live chat without this opt-in does not construct or probe the workspace runner. Follow [setup](setup.md) for model credentials and startup.

## Two different scopes

| Operation | What constrains it | What approval means |
|---|---|---|
| `list_files`, `read_file` | Selected workspace, permitted paths, bounded text capture | No mutation card; permitted content can enter model context |
| `edit_file` | Selected workspace, permitted path/content, unchanged prepared snapshot | Write the reviewed content to a real file, creating safe missing parents if needed |
| `run_command` | Validated executable/argv/cwd, resolved executable binding, timeout and output limits | Start a real host process with the reviewed arguments |

**A command's working directory is not a sandbox or an OS access boundary.** File tools have a workspace path policy; an approved program has the server user's OS permissions. A program can read other paths, use the network, load credentials from ordinary host files, or start subprocesses where those permissions allow it. The app does not claim container or VM isolation.

All ordinary agents receive the same enabled local tools. The primary can use them directly too. Names and personalities do not restrict an agent to a particular coding job.

## Listing and reading files

The runner captures permitted UTF-8 text files and a digest of their current state. This “snapshot” is a bounded view of the real folder, not a disposable copied checkout.

The current policy excludes hidden paths, dependency/build directories such as `node_modules` and `dist`, credential-like filenames and content, binary files, and symlinks or multiply linked files. Supported text extensions are listed in [runner-policy.ts](../src/server/runner-policy.ts). File-tool paths are relative, use a restricted segment syntax, and reject traversal. Each capture has caps on file count, file size, and total text; see [Limits](capabilities.md#limits).

These checks reduce accidental exposure through file tools. They are not a complete secret detector, and they do not restrict what an approved native program can access independently.

Reads need no approval, so a file’s text reaches the model as soon as an agent reads it. If the project may contain untrusted text, read [Untrusted text and web search](../SECURITY.md#untrusted-text-and-web-search) before leaving web search on.

**Trace it:** `snapshot`, `readFile`, file capture, and directory checks in [native-runner.ts](../src/server/native-runner.ts); path/content rules and limits in [runner-policy.ts](../src/server/runner-policy.ts).

## Creating or editing a file

Ask for a specific change, for example: “Create `notes/plan.txt` with a short test plan.” The model proposes an `edit_file` call and the app presents the concrete change. Only approval writes it.

New files can create missing parent directories beneath the selected folder after validation. Existing safe files are replaced through an atomic rename. The runner rechecks directory identities and the included-file snapshot so a changed workspace cannot silently reuse an earlier proposal.

This is an actual edit. There is no automatic undo, and restarting the app does not restore the previous file. A saved diff records what happened; it does not prove the file still has those contents.

## Running an installed program

The model-facing command request requires `executable`, `args`, and `cwd`; `cwd` accepts a string or `null`. A program name is resolved using the server's permitted `PATH`; an absolute executable path is also supported. The resolved invocation path and target metadata identity are bound before approval and checked again before execution.

Examples of requests you can make in live workspace mode:

- “Check the installed Git version.” The agent can propose `git` with `['--version']`.
- “Run the explicit test file.” It can propose `node` with `['--test', 'sum.test.js']`.
- “Create this directory using an installed CLI.” The resulting command still requires exact approval.

The runner uses an argument vector and `shell: false`. It does not expand pipes, redirects, or environment variables implicitly. An explicitly requested installed shell or interpreter is allowed; review its complete script argument. An installed package manager can run an approved install command, but there is no separate installation service and the command timeout still applies.

### Working directory versus argument paths

The model must include `cwd`: use `null` or `"."` for the selected workspace, or a permitted existing relative subdirectory. Leaving `cwd` out of the model-facing request is not valid. Tinkerfleet's SDK adapter then converts the request into the runner’s internal action, where `cwd` is optional. If the model gives the selected folder or a subdirectory as an absolute `cwd`, the adapter's `normalizeCommandCwd` function in [sdk/actions.ts](../src/server/sdk/actions.ts) turns it into a relative path before approval. That function is Tinkerfleet code, not part of the Agents SDK. An outside-workspace `cwd`, traversal, or symlink directory is rejected.

An argument is different. An explicitly proposed absolute path in `args` may refer outside the workspace. Its effect depends on the installed program and your OS permissions. Review the destination as well as the program name; choosing a workspace does not make all other machine paths inaccessible.

### Process lifetime and environment

Each command has a short, fixed timeout and a combined output limit ([Limits](capabilities.md#limits)). Output is bounded and redacted before returning to the model. Timeout, cancellation, and normal exit trigger process-group cleanup, including ordinary children left behind by the main process. This is not a persistent terminal or background-server launcher; programs that deliberately escape process-group control are not securely confined. For example, a process started with `setsid ... &` keeps running after cleanup, even when the output says `Process group stopped: yes`.

The child receives `HOME`, a filtered `PATH`, `TMPDIR`, `LANG`, and permitted `LC_ALL`/`LC_CTYPE` values. It does not inherit arbitrary server variables, the server API key, or loader-hook environment variables. The OS or program may add its own environment values. `HOME` still points at the user's home directory: minimal environment inheritance is not filesystem isolation. A command can also read the server’s own startup environment and files such as `.env.local`; [Credentials and approved commands](../SECURITY.md#credentials-and-approved-commands) explains how to protect your API key.

Changing model-turn or model-call limits does not change the local-command timeout. Separate model, context, output, and active-runtime limits live in [config.ts](../src/server/config.ts) and [sdk/contract.ts](../src/server/sdk/contract.ts).

## Several chats, one real folder

Local actions are serialized within this server. Separate conversations still share the selected folder, so one approved edit can invalidate another run's prepared snapshot. The second action must be proposed again against the changed state. Conversation isolation prevents history or approval ownership from crossing chats; it does not give each chat an isolated filesystem.

See [approvals](approvals.md) for the pause/resume path and [SECURITY.md](../SECURITY.md) for the complete trust model.

## Try and inspect

```sh
npm run lesson:3
npm run lesson:5
```

[Lesson 3](../lessons/03-tools.ts) explores structured tool validation. [Lesson 5](../lessons/05-local-tools.ts) uses a temporary folder to show a real approved edit, nested file creation, an installed Node command, and rejection of unapproved or replayed actions. It makes no model request and removes its teaching fixture afterward.

Then read [native-runner tests](../tests/native-runner.test.ts) for executable replacement, stale approvals, cancellation, path checks, and command cleanup. [HTTP tests](../tests/http.test.ts) exercise the full app → SDK → approval → native-runner path with scripted model responses. This separation lets you test the application mechanism without paying for inference or trusting a model to produce a particular action.
