import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeConfig} from '../src/server/config.js';

test('runtime defaults to chat-only and accepts reduced explicit budgets',()=>{
 const defaults=runtimeConfig({},{});assert.equal(defaults.workspaceToolsEnabled,false);assert.equal(defaults.reasoningEffort,null);
 const config=runtimeConfig({},{TINKERFLEET_WORKSPACE_TOOLS:'1',TINKERFLEET_MAX_MODEL_CALLS:'1',TINKERFLEET_MAX_OUTPUT_TOKENS:'512',TINKERFLEET_MAX_TOTAL_TOKENS:'2000',TINKERFLEET_MAX_RUN_MS:'5000',TINKERFLEET_REASONING_EFFORT:'minimal'});
 assert.equal(config.workspaceToolsEnabled,true);assert.equal(config.reasoningEffort,'minimal');assert.equal(config.limits.maxModelCalls,1);assert.equal(config.limits.maxOutputTokens,512);assert.equal(config.limits.maxTotalTokens,2000);assert.equal(config.limits.maxRunMs,5000);
});
test('runtime refuses malformed or enlarged budgets and unknown modes',()=>{
 for(const value of ['0','-1','1.5','13','Infinity',' 1'])assert.throws(()=>runtimeConfig({},{TINKERFLEET_MAX_MODEL_CALLS:value}));
 assert.throws(()=>runtimeConfig({sdkLimits:{maxOutputTokens:2049}},{}));assert.throws(()=>runtimeConfig({},{TINKERFLEET_WORKSPACE_TOOLS:'true'}));assert.throws(()=>runtimeConfig({},{TINKERFLEET_REASONING_EFFORT:'high'}));
});
