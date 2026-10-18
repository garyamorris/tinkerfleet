/**
 * The agent layer: how Tinkerfleet configures agents and drives the OpenAI Agents SDK.
 *
 * Read in this order:
 *   sdk/fleet.ts       how each agent is configured: instructions, tools, delegation
 *   sdk/run-fleet.ts   the tools one run gets: memory, workspace, coordination
 *   sdk/adapter.ts     the run lifecycle: start, pause for approval, resume, cancel
 *   sdk/model.ts       the model wrapper that enforces budgets and reports activity
 *
 * Supporting modules: sdk/contract.ts (shared types and limits), sdk/schemas.ts
 * (tool input schemas), sdk/actions.ts (parsing and fingerprinting proposed actions),
 * sdk/run-state.ts (per-run state), sdk/errors.ts (safe error messages) and
 * sdk/response-sources.ts (web citations).
 */
export * from './sdk/contract.js';
export { createFleetAgents } from './sdk/fleet.js';
export { createSdkAdapter } from './sdk/adapter.js';
export { redactSdkText } from './safety.js';
