# Interface tour

The interface keeps four questions visible: who is working, what happened, what
needs a decision, and what evidence came back.

## Roster

Coordinator, Scout, Maker, and Checker each have a recognizable original avatar.
The selected agent can be inspected and customized. Display name, color, and
shape are presentation settings. They never create an agent role, alter server
instructions, add a tool, or bypass approval.

## Conversation

Your task and the agents' visible replies appear in the central conversation.
Delegation shows the work moving between roles. This is a readable activity
summary; it is not private model reasoning or a guarantee that every model token
is shown. In demo mode the content is scripted around the tiny-project fixture.

## Work inspector

Use the work panel to inspect action proposals, activity, changes, and command
output. Check an edit before approving. Check the complete command, arguments,
and execution context before allowing it. A fingerprint identifies the exact
proposal; a green success label is meaningful only alongside its evidence and
whether the run is simulated.

The demo's command output is explicitly labeled **SIMULATED DEMO OUTPUT**. It is
an example of what a successful test might report. It is not a Docker transcript.
Live errors should stay visible rather than being turned into fabricated success.

## Runs and cancellation

A run can be working, waiting for approval, completed, denied, cancelled, or
failed. Starting another run does not make an old decision valid for the new one.
Stopping invalidates pending approvals. Restarting the server loses the history
and working state; reload the browser to establish a fresh local session.

## Keyboard and small screens

Use Tab and Shift+Tab to move focus, Enter or Space to activate a focused
button, and visible labels rather than avatar color alone to identify a role.
Within the inspector tabs, use the arrow keys to switch tabs and Home or End to
reach the first or last tab. Dialogs move focus inside when opened; Escape closes
them and returns focus to the control that opened them. On a narrow screen, the side panels
move out of the way so the conversation remains readable. If a panel is hidden,
reopen it before deciding an action; never approve something you have not read.

## Recorded browser checks

Chrome was checked at 1440 × 1000 and 390 × 844 for the no-key demo. The checks
covered denial, edit and command approval, simulated completion, mobile panels,
and keyboard behavior for the lesson dialog and inspector tabs. No browser
console errors were observed. The production server also opened the interface.
See [screenshots](../README.md#a-look-inside) and the
[handover](../HANDOVER.txt) for evidence and remaining verification.
Artifact download completion remains unverified; a download control alone is
not evidence that a file was saved successfully.
