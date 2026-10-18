# Build an agent app, step by step

This guide is for someone who wants to build a personal agent tool: a place to
chat with a primary assistant, give it useful capabilities, and create other
agents when they help. Tinkerfleet is the working example you can inspect and change.

Work through the milestones below in order. Each adds one application concept.
You can use the same sequence to build your own app with a different interface,
provider, or set of tools. The source links show how this particular app implements it.

## 1. Separate the model from the application

A language model receives input and produces output. When tools are available,
its output can include a request to call a function. A model response alone does
not read your disk, start another bot, or update the interface. Your application
connects those requests to code.

An agent is a configured model interaction: instructions, available tools, and
context, run through a loop. In simplified pseudocode:

```text
give the model the user request and available tool descriptions
repeat:
    ask the model for its next response
    if it has a final answer, return that answer
    validate its requested tool calls
    pause for approval where required
    execute the permitted tools
    give their results back to the model
```

The OpenAI Agents SDK implements much of this loop in Tinkerfleet. The surrounding
application still owns storage, permissions, UI, and the functions that do work.
See the official [running agents guide](https://openai.github.io/openai-agents-js/guides/running-agents/)
for the SDK’s execution model.

**Run:** `npm run lesson:0` to watch this loop run, first by hand and then through
the SDK with a scripted model. Then read
[`createFleetAgents` in sdk.ts](../src/server/sdk.ts) and run `npm run lesson:1`.
**Check your understanding:** why can lesson 1 construct an agent without an
API key? Because defining its configuration is separate from asking a model to respond.

## 2. Build the chat before adding autonomy

Begin with a text input, a send button, and a list of messages. Give each submitted
request an identity so the interface can follow its status.

Tinkerfleet uses three different objects:

| Object | What it owns | Example |
| --- | --- | --- |
| Bot profile | Name, personality, appearance, stable identity | Nova, a patient astronomy tutor |
| Conversation | Captured participants, messages through its runs, title, unsent draft | “Learning about planets” |
| Run | One submitted request and the work it triggers, possibly several model calls: activity, approvals, result, usage | “Explain why seasons happen” |

A new message starts a new run inside the same conversation. One bot can take part
in many conversations. Changing a conversation title should not change the bot’s
identity, and cancelling a run should not delete the conversation.

The browser sends a request to the local server. The server creates the run and
starts its execution asynchronously. The client polls state to update messages,
activity, and approval cards. This lets the user see work in progress without
waiting for a single long HTTP response to finish.

**Read:** [shared types](../src/shared/types.ts), [client](../src/client/main.tsx),
and [`startRun` in app.ts](../src/server/app.ts).
**Try:** write a draft in one chat, switch chats, and return. Trace which fields
store the draft and which store completed messages.

## 3. Give the agent one tool

A tool has a name, a description, an input schema, and an implementation. The
model uses the description to decide when to request it. The schema defines the
arguments; the implementation does the work.

Here is the shape of a real file-read request in Tinkerfleet:

```json
{
  "path": "sum.js"
}
```

That JSON is input to `read_file`. The tool implementation checks the run and
calls the workspace reader, which validates the path and returns bounded text.
The result becomes model input for the next step. The model can then explain
what it read or decide it needs another tool.

The useful development question is: **what is the smallest function that gives
the agent a capability it currently lacks?** Reading a text file is a clearer
first tool than a general-purpose “do anything” function.

**Read:** `readTools` inside `makeFleet` in [sdk.ts](../src/server/sdk.ts), then
[workspace validation](../src/server/runner-policy.ts).
**Run:** `npm run lesson:3`.
**Build next:** the [extension guide](extending.md) walks through adding a small tool.

## 4. Add actions with a visible decision point

Reading information and changing the world require different interaction designs.
A user should be able to inspect what a file edit or command will do before it runs.

For example, the model can propose this command:

```json
{
  "executable": "node",
  "args": ["--test", "sum.test.js"],
  "cwd": "."
}
```

Tinkerfleet pauses its SDK run, prepares an exact action, and shows a decision
card. The server binds approval to that action and run. When the user approves,
the saved run resumes and the action can execute once. If the arguments change,
the earlier decision no longer authorizes it.

This is an application protocol with state transitions. Writing “always ask
permission” in an agent’s personality cannot implement it.

**Read:** [how approvals work](approvals.md).
**Run:** `npm run lesson:4`.
**Try:** deny a command in the demo. Find the code that prevents execution rather
than just changing the button’s appearance.

## 5. Connect local tools to the computer

The native runner is where an approved proposal becomes an actual file write or
process. It resolves a command, starts it with separate arguments, collects output,
and reports the exit status. File edits write the proposed content to a validated path.

Keep the result structured. “The command ran” is incomplete: the application also
needs to know whether it completed, failed, timed out, or was cancelled. The agent
needs that information to choose its next step; the user needs it to judge progress.

Tinkerfleet’s file tools stay within a selected project. Native commands run with
the host user’s permissions; their arguments can address other locations. The
short, fixed command timeout ([Limits](capabilities.md#limits)) is useful to study
because it exposes a real product tradeoff: simple short-lived tools are easy to
manage, but long builds need background job IDs, progress, cancellation, and
result collection.

**Read:** [workspace tools](workspace.md) and [native-runner.ts](../src/server/native-runner.ts).
**Run:** `npm run lesson:5` to approve a real edit and command in a temporary
folder. Then run `npm run lesson:6` to see which files the file tools can see,
and how a changed file changes the workspace digest.
**Design exercise:** sketch what a `start_job` result would contain. How would a
later `get_job_status` call distinguish “still running” from “finished successfully”?
These job tools are an extension idea, not existing Tinkerfleet tools.

## 6. Add personalities without inventing permission classes

A profile gives an agent a name and a purpose: its expertise, tone, and working
style. For example, “Explain astronomy patiently using small visual examples”
helps shape a tutor’s replies.

The server separately supplies the tools. Ordinary Tinkerfleet agents receive
the same enabled file, command, web, and memory capabilities. Scout, Maker, and
Checker are starter personalities; their names do not enforce a workflow.

Appearance is another independent field. A random avatar helps distinguish bots
in the interface. It is not a model setting or an access policy.

The primary can use `create_agent` to request a name and purpose. The server
validates the request, creates a stable profile ID and random appearance, saves
them, and creates a direct chat. The message link points to that actual chat.

**Read:** [`createAgent` in app.ts](../src/server/app.ts),
[profile validation](../src/server/personas.ts), and [appearance](../src/shared/appearance.ts).
**Try:** create Nova in the demo, then change its appearance. Which data changes?
Does its existing chat acquire different tool permissions?

## 7. Coordinate through explicit messages

Start with a primary that can do the task itself. Add another agent when a
separate perspective, purpose, or conversation is useful.

Tinkerfleet demonstrates three related mechanisms:

- **Direct conversation:** the user speaks with one bot. No coordinator is
  required for that exchange.
- **Message an agent:** the primary sends a brief to an ordinary agent’s chat.
  That creates a separate run. Its reply or status is relayed back to the source
  conversation; the primary can use it on its next turn.
- **Create a group:** the primary selects participants and supplies a brief for
  a new shared conversation. Within the group it can call selected agents as
  tools and receive their results.

A shared chat is not a promise that every bot is running simultaneously. Separate
runs and nested agent calls have different lifetimes. The current app does not
automatically wake the primary for another model turn when a recipient finishes.

**Read:** [coordination in the architecture guide](architecture.md) and
[`messageAgent` / `startGroup` in app.ts](../src/server/app.ts).
**Run:** `npm run lesson:2`.
**Try:** in the demo, ask Orbit **“Ask Nova: Hello”** after creating Nova. Visit
Nova’s chat, then return to Orbit through the sidebar to find the relayed reply.
In the server code, follow `sentBy` and `recipientRunId` to see how the two runs are linked.

## 8. Decide what “memory” means

Saved conversation history, active SDK state, and durable bot memory solve
separate problems. History supplies recent context in the same chat. SDK state
holds an execution that is in progress. Memory stores facts worth supplying to
the same bot in later conversations.

Tinkerfleet uses a small JSON memory store keyed by bot ID. At the start of a
run, the app loads each participating bot’s own notes and includes them in that
bot’s instructions as context. Tools let the bot recall, save, and forget entries.
The user can inspect and change the same notes through the interface.

This design needs no embeddings or vector database. All of a bot’s saved notes
fit within a bounded context. Retrieval and summaries become useful extensions
when that assumption stops holding.

**Read:** [the memory walkthrough](memory.md).
**Try:** add a preference to Nova’s Memory panel, then open a new conversation
with that same bot. In live mode, observe whether its reply uses the preference.
A scripted demo does not adapt its replies to memory.
**Test without paying:** inspect the memory-preload tests in
[sdk.test.ts](../tests/sdk.test.ts), which check the actual context sent to a fake model.

## 9. Add web research and show evidence

Local function tools and provider-hosted tools can coexist. Tinkerfleet supplies
workspace functions from its Node process and enables hosted web search through
the Agents SDK. The hosted service performs the search; the local application
receives tool events and source annotations.

This app’s web feature supports public research and model-supported page reading.
It does not drive the user’s browser, reuse their logged-in sessions, or fill forms.
Those would require a separate browser capability and interaction design.

Show sources close to the answer they support. Preserve source URLs with saved
messages so the user can revisit them after a reload. Treat page text as evidence
to assess, not as instructions that can grant a local tool permission.

**Read:** [source handling](../src/server/sources.ts),
[Markdown and citations](../src/client/citations.tsx), and the
[capability guide](capabilities.md).
**Exercise:** explain why rendering a link safely and checking whether its claim
is true are different responsibilities.

## 10. Make progress understandable

A blank chat while a tool runs leaves the user guessing. Record useful lifecycle
events: agent started, reading a file, waiting for approval, command finished,
and run complete. Display those events with the agent identity and elapsed time.

Tinkerfleet’s compact activity summary expands into details. Assistant messages
render Markdown, including code and tables. Command output and file diffs have
their own views because they answer different questions from a prose reply.

These events are observations of execution. They are not a transcript of hidden
model reasoning. A tool’s “finished” event means the call returned; check its
result to learn whether the requested work succeeded.

**Read:** [`onEvent` in app.ts](../src/server/app.ts),
[run-activity.tsx](../src/client/run-activity.tsx), and the [interface tour](interface.md).
**Try:** follow a demo approval from pending to approved to complete. Identify
which state belongs to the approval and which belongs to the run.

## 11. Test the application around the model

Use deterministic inputs to check whether your application follows its own
rules. Tinkerfleet uses the real SDK with a scripted fake model to test tool
requests, interruptions, memory context, and resumption. Native runner tests use
temporary files and real short commands. Neither requires remote inference.

A live check answers a different question: does the chosen provider and model
work with these tools and produce useful results? Separate that evidence from
unit tests and scripted browser demonstrations.

**Run:** `npm run check`.
**Read:** [testing an agent application](testing.md).
**Exercise:** invent one failure test for each feature you have added. For
memory, try the wrong bot’s entry ID. For approvals, try replaying a used decision.

## 12. Choose your next project

Now take the pieces you understand and choose a focused application:

| Project | First useful tool | Later addition |
| --- | --- | --- |
| A learning companion | Read supplied notes | Per-learner preferences and cited explanations |
| A project assistant | List and read project files | Approved edits and short test commands |
| A research helper | Search public sources | Compare findings from two distinct perspectives |
| A creative coding helper | Write a reviewed starter file | Track a longer build job and preview its result |

Start with one useful end-to-end task. Expand the tool set, memory, or agent
coordination when it helps that task. The [extension guide](extending.md) is your
next stop for making a concrete change to this repository.
