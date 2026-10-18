import { DEFAULT_SDK_LIMITS, type SdkLimits } from './sdk.js';
export type ReasoningEffort = 'none' | 'minimal' | 'low';
export interface RuntimeOptions {
  webSearchEnabled?: boolean;
  workspaceToolsEnabled?: boolean;
  sdkLimits?: Partial<SdkLimits>;
  reasoningEffort?: ReasoningEffort;
}
/** Finite count limits have these ceilings; zero disables only turn and model-call count caps. */
export const HARD_SDK_LIMITS: Readonly<SdkLimits> = Object.freeze({
  maxTurns: 64,
  maxModelCalls: 64,
  maxOutputTokens: 16_384,
  maxTotalTokens: 1_000_000,
  maxInputChars: 256_000,
  maxOutputChars: 256_000,
  maxRunMs: 10 * 60_000,
  maxPendingMs: 30 * 60_000,
  maxRetainedRuns: 100,
});
export function runtimeConfig(options: RuntimeOptions = {}, env: NodeJS.ProcessEnv = process.env) {
  const webSetting = env.TINKERFLEET_WEB_SEARCH;
  if (
    options.webSearchEnabled === undefined &&
    webSetting !== undefined &&
    !['0', '1', ''].includes(webSetting)
  )
    throw new Error('TINKERFLEET_WEB_SEARCH must be 0 or 1.');
  const webSearchEnabled = options.webSearchEnabled ?? webSetting !== '0';
  const setting = env.TINKERFLEET_WORKSPACE_TOOLS;
  if (
    options.workspaceToolsEnabled === undefined &&
    setting !== undefined &&
    !['0', '1', ''].includes(setting)
  )
    throw new Error('TINKERFLEET_WORKSPACE_TOOLS must be 0 or 1.');
  const workspaceToolsEnabled = options.workspaceToolsEnabled ?? setting === '1';
  const reasoningEffort =
    options.reasoningEffort ?? env.TINKERFLEET_REASONING_EFFORT?.trim() ?? null;
  if (reasoningEffort !== null && !['none', 'minimal', 'low'].includes(reasoningEffort))
    throw new Error('Reasoning effort must be none, minimal, or low.');
  const limits = { ...DEFAULT_SDK_LIMITS };
  const names = {
    maxTurns: 'TINKERFLEET_MAX_TURNS',
    maxModelCalls: 'TINKERFLEET_MAX_MODEL_CALLS',
    maxOutputTokens: 'TINKERFLEET_MAX_OUTPUT_TOKENS',
    maxTotalTokens: 'TINKERFLEET_MAX_TOTAL_TOKENS',
    maxRunMs: 'TINKERFLEET_MAX_RUN_MS',
  } as const;
  for (const [key, name] of Object.entries(names)) {
    const value = env[name];
    if (value !== undefined) {
      if (!/^\d+$/.test(value))
        throw new Error(`${name} must be an integer within its configured range.`);
      limits[key as keyof SdkLimits] = Number(value);
    }
  }
  for (const [key, value] of Object.entries(options.sdkLimits ?? {})) {
    if (!Object.hasOwn(HARD_SDK_LIMITS, key)) throw new Error('Unknown SDK limit.');
    limits[key as keyof SdkLimits] = value;
  }
  for (const key of Object.keys(limits) as (keyof SdkLimits)[]) {
    const countLimit = key === 'maxTurns' || key === 'maxModelCalls';
    if (
      !Number.isSafeInteger(limits[key]) ||
      limits[key] < (countLimit ? 0 : 1) ||
      limits[key] > HARD_SDK_LIMITS[key]
    )
      throw new Error(
        `${key} must be ${countLimit ? '0 (unlimited) or ' : ''}a positive integer no higher than ${HARD_SDK_LIMITS[key]}.`,
      );
  }
  return {
    webSearchEnabled,
    workspaceToolsEnabled,
    reasoningEffort: reasoningEffort as ReasoningEffort | null,
    limits,
  };
}
