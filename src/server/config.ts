import {DEFAULT_SDK_LIMITS,type SdkLimits} from './sdk.js';
export type ReasoningEffort='none'|'minimal'|'low';
export interface RuntimeOptions {webSearchEnabled?:boolean;workspaceToolsEnabled?:boolean;sdkLimits?:Partial<SdkLimits>;reasoningEffort?:ReasoningEffort}
export function runtimeConfig(options:RuntimeOptions={},env:NodeJS.ProcessEnv=process.env){
 const webSetting=env.TINKERFLEET_WEB_SEARCH;
 if(options.webSearchEnabled===undefined&&webSetting!==undefined&&!['0','1',''].includes(webSetting))throw new Error('TINKERFLEET_WEB_SEARCH must be 0 or 1.');
 const webSearchEnabled=options.webSearchEnabled??webSetting!=='0';
 const setting=env.TINKERFLEET_WORKSPACE_TOOLS;
 if(options.workspaceToolsEnabled===undefined&&setting!==undefined&&!['0','1',''].includes(setting))throw new Error('TINKERFLEET_WORKSPACE_TOOLS must be 0 or 1.');
 const workspaceToolsEnabled=options.workspaceToolsEnabled??setting==='1';
 const reasoningEffort=options.reasoningEffort??env.TINKERFLEET_REASONING_EFFORT?.trim()??null;
 if(reasoningEffort!==null&&!['none','minimal','low'].includes(reasoningEffort))throw new Error('Reasoning effort must be none, minimal, or low.');
 const limits={...DEFAULT_SDK_LIMITS};
 const names={maxModelCalls:'TINKERFLEET_MAX_MODEL_CALLS',maxOutputTokens:'TINKERFLEET_MAX_OUTPUT_TOKENS',maxTotalTokens:'TINKERFLEET_MAX_TOTAL_TOKENS',maxRunMs:'TINKERFLEET_MAX_RUN_MS'} as const;
 for(const [key,name] of Object.entries(names)){const value=env[name];if(value!==undefined){if(!/^\d+$/.test(value))throw new Error(`${name} must be a positive integer within its default cap.`);limits[key as keyof SdkLimits]=Number(value);}}
 for(const [key,value] of Object.entries(options.sdkLimits??{})){if(!(key in DEFAULT_SDK_LIMITS))throw new Error('Unknown SDK limit.');limits[key as keyof SdkLimits]=value;}
 for(const key of Object.keys(limits) as (keyof SdkLimits)[])if(!Number.isSafeInteger(limits[key])||limits[key]<1||limits[key]>DEFAULT_SDK_LIMITS[key])throw new Error(`${key} must be positive and no higher than its default cap.`);
 return {webSearchEnabled,workspaceToolsEnabled,reasoningEffort:reasoningEffort as ReasoningEffort|null,limits};
}
