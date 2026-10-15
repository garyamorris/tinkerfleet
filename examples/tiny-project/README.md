# A small addition exercise

This dependency-free fixture gives you a change you can understand before
approving it. [`sum.js`](sum.js) currently subtracts its second argument.
[`sum.test.js`](sum.test.js) expects addition.

From the repository root, run just these tests:

```sh
node --test examples/tiny-project/sum.test.js
```

With the original fixture, the positive-number and negative-number cases fail;
the zero case passes. The test process exits unsuccessfully. That is the intended
starting point. After a correct repair, all three pass.

## Practice in a separate folder

Copy only the exercise files into a fresh temporary directory so that your
experiment has its own source and test state:

```sh
practice_dir=$(mktemp -d)
cp examples/tiny-project/sum.js examples/tiny-project/sum.test.js examples/tiny-project/package.json "$practice_dir/"
node --test "$practice_dir/sum.test.js"
```

Keep the printed test result as your baseline. The copied `package.json` marks
the files as ES modules; no dependency installation is needed in that folder.
You can print the selected path with `printf '%s\n' "$practice_dir"`.

## Follow the action through Tinkerfleet

The demo can show the scripted approval flow without making model calls or
changing these files. For a real agent-driven edit, follow
[setup](../../docs/setup.md) and select the disposable folder as the workspace
with local tools enabled. Live inference uses the configured provider and may
incur charges; it is separate from running this fixture's Node tests.

Give the agent a bounded request:

> Read sum.js and sum.test.js. Explain the failing addition cases, propose the
> smallest repair to sum.js, and run node --test sum.test.js after I approve it.

Review the proposed path and full replacement content before approving the edit.
Review the resolved executable, arguments, and working directory before approving
the command. An edit and a test command are separate actions. Check the reported
exit code and test output, then run the same test command yourself against the
copied file. A passing test checks these three examples, not every possible input.

Approved edits change real files. Commands run with your user permissions, and
the selected folder is not an OS sandbox. Other chats using the same folder see
the same changes. See [workspace behavior](../../docs/workspace.md).

## Extend the exercise

Add a fractional-number case to the copied test file. Predict its expected value
before running it. Then inspect [lesson 5](../../lessons/05-local-tools.ts) to see
how an approval reaches a real file write and command without involving a model.
The [testing guide](../../docs/testing.md) explains how the complete app checks
that same path with scripted model responses.
