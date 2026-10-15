# Interface tour

The conversation is the main canvas. **Team** opens reusable profiles and role
assignments, **Runs** opens the current server session's history, and **Details**
shows activity, output, and changes when you need them.

## Personas and roles

A persona is a reusable profile with a name, purpose, color, and avatar shape.
A role supplies a fixed job and tool set. Every team has exactly one Coordinator,
Researcher, Builder, and Reviewer; creating a profile adds a choice to your library, not
an extra agent slot.

A purpose describes the focus you want within that role. For example, a Scout
in the Researcher role could “Explain unfamiliar TypeScript and find the smallest
relevant files.” In
live mode, the assigned agent receives that purpose in its SDK instructions.
Researcher (`scout`) still has read-only tools. Builder (`maker`) and Reviewer
(`checker`) can both propose edits and commands, with approval required for each. A purpose cannot change these permissions. Colors and shapes are
presentation settings.

In demo mode, custom profiles personalize the team while the tiny-project flow
remains scripted. Changing a purpose does not create model intelligence or make
the demo answer arbitrary tasks.

## Create and use a profile

Open **Team** and choose **Create persona**. Fill in **Name** and **Purpose**,
choose a **Role**, and pick a color and avatar shape under **Appearance**.
**Save persona** adds the profile to your library and immediately assigns it to
that role for future tasks.

Use a role's dropdown in Team to reuse another saved profile for the same role.
Use **Edit** beside the assigned profile to change it. All four slots remain
filled; saving a persona into a different role preserves a valid assignment for
the role it leaves.

Names allow up to 40 characters; purposes allow up to 600 and may span multiple
lines. Use a concrete focus rather than asking for broader access. Never put
credentials or private information in a profile.

The library is stored locally in this browser. It survives a server restart but
does not sync across browsers; clearing site data removes it. Existing cosmetic
preferences are migrated into profiles. Profile storage is not an encrypted
secret store. Selected names and purposes can be sent to OpenAI in live mode.

When a task starts, the local server validates and freezes a copy of the four
selected profiles. Editing or reassigning profiles afterward affects future
runs. A past or running task keeps its original names, purposes, and appearances.
This team snapshot is separate from the workspace snapshot containing files.

## Conversation and approvals

Your task and the agents' visible replies appear in the conversation. Delegation
shows work moving between roles. This is a readable activity summary, not private
model reasoning or a guarantee that every model token is shown.

Read the exact edit or complete command before deciding an approval. A fingerprint
identifies the proposal. Denying does not execute that action; stopping invalidates
pending approvals. Profile customization never stands in for an approval.

## Details and run history

Open **Details** to inspect Activity, Output, or Changes. A green success label is
meaningful only alongside its evidence and whether the run is simulated. The
demo's command output is explicitly labeled **SIMULATED DEMO OUTPUT**; it is not
a Docker transcript. Live errors should stay visible rather than becoming
fabricated success.

**Runs** lets you return to tasks in the current server session. Runs can be
working, waiting for approval, completed, denied, cancelled, or failed. Starting
another task does not make an old decision valid. Restarting the server discards
run history, file snapshots, and pending decisions; reload the browser afterward.
Your browser's reusable profile library remains separate from that run history.

## Keyboard and small screens

Use Tab and Shift+Tab to move focus and Enter or Space to activate buttons.
Use Left and Right arrows within the Details tabs, or Home and End to reach the
first and last tabs. Identify roles by their labels rather than avatar color
alone. Open Team or
Details when needed, keeping the conversation readable on narrow screens.
Always read the action before approving it.

See the [handover](../HANDOVER.txt) for recorded verification and limitations.
