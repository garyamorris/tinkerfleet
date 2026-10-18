import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeConfig, HARD_SDK_LIMITS } from '../src/server/config.js';
import { DEFAULT_SDK_LIMITS, type SdkLimits } from '../src/server/sdk.js';

test('runtime defaults to chat-only and accepts reduced explicit budgets', () => {
  const defaults = runtimeConfig({}, {});
  assert.equal(defaults.workspaceToolsEnabled, false);
  assert.equal(defaults.reasoningEffort, null);
  assert.deepEqual(defaults.limits, DEFAULT_SDK_LIMITS);
  const config = runtimeConfig(
    {},
    {
      TINKERFLEET_WORKSPACE_TOOLS: '1',
      TINKERFLEET_MAX_MODEL_CALLS: '1',
      TINKERFLEET_MAX_OUTPUT_TOKENS: '512',
      TINKERFLEET_MAX_TOTAL_TOKENS: '2000',
      TINKERFLEET_MAX_RUN_MS: '5000',
      TINKERFLEET_REASONING_EFFORT: 'minimal',
    },
  );
  assert.equal(config.workspaceToolsEnabled, true);
  assert.equal(config.reasoningEffort, 'minimal');
  assert.equal(config.limits.maxModelCalls, 1);
  assert.equal(config.limits.maxOutputTokens, 512);
  assert.equal(config.limits.maxTotalTokens, 2000);
  assert.equal(config.limits.maxRunMs, 5000);
});
test('operators may raise defaults without exceeding separate hard ceilings', () => {
  const config = runtimeConfig(
    {},
    {
      TINKERFLEET_MAX_MODEL_CALLS: '20',
      TINKERFLEET_MAX_OUTPUT_TOKENS: '8192',
      TINKERFLEET_MAX_TOTAL_TOKENS: '128000',
      TINKERFLEET_MAX_RUN_MS: '300000',
    },
  );
  assert.equal(config.limits.maxModelCalls, 20);
  assert.equal(config.limits.maxOutputTokens, 8192);
  assert.equal(config.limits.maxTotalTokens, 128000);
  assert.equal(config.limits.maxRunMs, 300000);
  assert.equal(
    runtimeConfig(
      { sdkLimits: { maxTotalTokens: 96000 } },
      { TINKERFLEET_MAX_TOTAL_TOKENS: '128000' },
    ).limits.maxTotalTokens,
    96000,
  );
  assert.deepEqual(
    runtimeConfig({ sdkLimits: { ...HARD_SDK_LIMITS } }, {}).limits,
    HARD_SDK_LIMITS,
  );
});
test('malformed budgets, hard-cap violations, unknown limits and modes are rejected', () => {
  for (const value of [
    '-1',
    '1.5',
    String(HARD_SDK_LIMITS.maxModelCalls + 1),
    'Infinity',
    ' 1',
    '9007199254740993',
  ])
    assert.throws(() => runtimeConfig({}, { TINKERFLEET_MAX_MODEL_CALLS: value }));
  for (const key of Object.keys(HARD_SDK_LIMITS) as (keyof SdkLimits)[])
    assert.throws(() => runtimeConfig({ sdkLimits: { [key]: HARD_SDK_LIMITS[key] + 1 } }, {}));
  assert.throws(() => runtimeConfig({ sdkLimits: { maxOutputTokens: NaN } }, {}));
  assert.throws(() =>
    runtimeConfig({ sdkLimits: { toString: 5 } as unknown as Partial<SdkLimits> }, {}),
  );
  assert.throws(() => runtimeConfig({}, { TINKERFLEET_WORKSPACE_TOOLS: 'true' }));
  assert.throws(() => runtimeConfig({}, { TINKERFLEET_REASONING_EFFORT: 'high' }));
});
test('live web search defaults enabled and accepts explicit off only as validated configuration', () => {
  assert.equal(runtimeConfig({}, {}).webSearchEnabled, true);
  assert.equal(runtimeConfig({}, { TINKERFLEET_WEB_SEARCH: '0' }).webSearchEnabled, false);
  assert.equal(runtimeConfig({}, { TINKERFLEET_WEB_SEARCH: '1' }).webSearchEnabled, true);
  assert.throws(() => runtimeConfig({}, { TINKERFLEET_WEB_SEARCH: 'yes' }));
  assert.equal(runtimeConfig({ webSearchEnabled: false }, {}).webSearchEnabled, false);
});

test('zero disables count caps while explicit finite counts remain available', () => {
  const defaults = runtimeConfig({}, {});
  assert.equal(defaults.limits.maxTurns, 0);
  assert.equal(defaults.limits.maxModelCalls, 0);
  const unlimited = runtimeConfig(
    {},
    { TINKERFLEET_MAX_TURNS: '0', TINKERFLEET_MAX_MODEL_CALLS: '0' },
  );
  assert.equal(unlimited.limits.maxTurns, 0);
  assert.equal(unlimited.limits.maxModelCalls, 0);
  const finite = runtimeConfig(
    {},
    { TINKERFLEET_MAX_TURNS: '8', TINKERFLEET_MAX_MODEL_CALLS: '12' },
  );
  assert.equal(finite.limits.maxTurns, 8);
  assert.equal(finite.limits.maxModelCalls, 12);
  const override = runtimeConfig(
    { sdkLimits: { maxTurns: 0, maxModelCalls: 0 } },
    { TINKERFLEET_MAX_TURNS: '8', TINKERFLEET_MAX_MODEL_CALLS: '12' },
  );
  assert.equal(override.limits.maxTurns, 0);
  assert.equal(override.limits.maxModelCalls, 0);
  assert.equal(JSON.parse(JSON.stringify(unlimited.limits)).maxTurns, 0);
  assert.equal(JSON.parse(JSON.stringify(unlimited.limits)).maxModelCalls, 0);
});

test('unlimited count sentinel never disables token, time, output or resource budgets', () => {
  for (const key of Object.keys(HARD_SDK_LIMITS) as (keyof SdkLimits)[]) {
    if (key === 'maxTurns' || key === 'maxModelCalls') continue;
    assert.throws(() => runtimeConfig({ sdkLimits: { [key]: 0 } }, {}));
  }
  for (const name of [
    'TINKERFLEET_MAX_OUTPUT_TOKENS',
    'TINKERFLEET_MAX_TOTAL_TOKENS',
    'TINKERFLEET_MAX_RUN_MS',
  ])
    assert.throws(() => runtimeConfig({}, { [name]: '0' }));
  for (const value of ['-1', '1.5', 'Infinity', ' 0', String(HARD_SDK_LIMITS.maxTurns + 1)])
    assert.throws(() => runtimeConfig({}, { TINKERFLEET_MAX_TURNS: value }));
  for (const key of ['maxTurns', 'maxModelCalls'] as const)
    assert.throws(() => runtimeConfig({ sdkLimits: { [key]: Infinity } }, {}));
});
