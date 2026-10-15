import test from 'node:test';
import assert from 'node:assert/strict';
import type {ModelRequest} from '@openai/agents';
import {ContextBudgetError,modelInputChars,recentConversationContext,trimModelRequest} from '../src/server/context-budget.js';

const user = (text:string) => ({type:'message',role:'user',content:text});
const assistant = (text:string) => ({type:'message',role:'assistant',content:[{type:'output_text',text}]});
const call = (id:string,args='{}') => ({type:'function_call',callId:id,name:'read_file',arguments:args});
const result = (id:string,text:string) => ({type:'function_call_result',callId:id,name:'read_file',status:'completed',output:text});
function request(input:unknown,rest:Partial<ModelRequest>={}):ModelRequest {
 return {input:input as ModelRequest['input'],systemInstructions:'Follow the user request and approval policy.',modelSettings:{},tools:[],outputType:'text',handoffs:[],tracing:false,...rest};
}
const items=(value:ModelRequest)=>value.input as unknown as Record<string,unknown>[];

test('count includes instructions and large tool schemas, not just user text',()=>{
 const r=request('Current prompt',{tools:[{name:'large',type:'function',description:'d'.repeat(5000),parameters:{type:'object'}} as unknown as ModelRequest['tools'][number]]});
 assert.ok(modelInputChars(r)>5000);
 assert.throws(()=>trimModelRequest(r,{maxInputChars:1000}),ContextBudgetError);
 assert.equal(trimModelRequest(r,{maxInputChars:10000}).request.input,'Current prompt');
});

test('whole old turns are removed while the current user and recent answer remain intact',()=>{
 const current='Keep this full current request — including constraints.';
 const r=request([user('old question'.repeat(500)),assistant('old answer'.repeat(500)),user('recent question'),assistant('recent answer'),user(current)]);
 const before=structuredClone(r);
 const trimmed=trimModelRequest(r,{maxInputChars:1000});
 assert.equal(trimmed.trimmed,true);assert.equal(trimmed.removedItems,2);
 assert.deepEqual(items(trimmed.request),[user('recent question'),assistant('recent answer'),user(current)]);
 assert.deepEqual(r,before);assert.ok(trimmed.inputChars<=1000);
});

test('old tool calls, results, and attached reasoning are dropped together',()=>{
 const reasoning={type:'reasoning',id:'reasoning-old',content:[{type:'reasoning_text',text:'opaque provider reasoning'}],providerData:{encrypted_content:'opaque'}};
 const latestArgs='{"path":"latest.txt"}';
 const r=request([user('current'),reasoning,call('old','{"path":"'+'x'.repeat(1000)+'"}'),result('old','earlier result'),call('latest',latestArgs),result('latest','recent result')]);
 const trimmed=trimModelRequest(r,{maxInputChars:650});
 assert.deepEqual(items(trimmed.request),[user('current'),call('latest',latestArgs),result('latest','recent result')]);
 assert.equal(trimmed.removedItems,3);assert.ok(trimmed.inputChars<=650);
});

test('interleaved tool calls remain paired and their exact arguments are never shortened',()=>{
 const r=request([user('current'),call('one','{"content":"'+'a'.repeat(700)+'"}'),call('two'),result('one','one'),result('two','two')]);
 const trimmed=trimModelRequest(r,{maxInputChars:600});
 assert.deepEqual(items(trimmed.request),[user('current'),call('two'),result('two','two')]);
 const protectedLarge=request([user('current'),call('latest','{"content":"'+'b'.repeat(700)+'"}'),result('latest','result')]);
 assert.throws(()=>trimModelRequest(protectedLarge,{maxInputChars:600}),ContextBudgetError);
});

test('long tool text is visibly bounded without mutating RunState or provider metadata',()=>{
 const output='START\n'+'x'.repeat(5000)+'\nFINAL ERROR';
 const metadata={trace:'opaque',cacheKey:'preserve'};
 const r=request([user('current'),call('read'),{...result('read',output),id:'result-id',providerData:metadata}]);
 const before=structuredClone(r);
 const trimmed=trimModelRequest(r,{maxInputChars:1000,maxToolOutputChars:180});
 const last=items(trimmed.request).at(-1)!;
 assert.ok(String(last.output).length<=180);assert.match(String(last.output),/^START/);assert.match(String(last.output),/Tool output truncated/);assert.match(String(last.output),/FINAL ERROR$/);
 assert.deepEqual(last.providerData,metadata);assert.equal(last.id,'result-id');assert.equal(trimmed.trimmedToolOutputs,1);assert.deepEqual(r,before);
});

test('structured text and shell outputs share a bounded output allowance',()=>{
 for(const output of [[{type:'input_text',text:'a'.repeat(400)},{type:'input_text',text:'b'.repeat(400)}],[{stdout:'a'.repeat(400),stderr:'b'.repeat(400)}]]){
  const r=request([user('current'),call('structured'),{...result('structured',''),output}]);
  const trimmed=trimModelRequest(r,{maxInputChars:1000,maxToolOutputChars:100});
  const text=JSON.stringify(items(trimmed.request).at(-1)!.output);
  assert.ok(text.length<250);assert.equal(trimmed.trimmedToolOutputs,1);
 }
});

test('local item references move with their targets; cached remote references remain intact',()=>{
 const old={...assistant('x'.repeat(1000)),id:'old-message'};
 const r=request([old,{type:'item_reference',id:'old-message'},user('current')],{previousResponseId:'provider-response',conversationId:'provider-conversation'});
 const trimmed=trimModelRequest(r,{maxInputChars:500});
 assert.deepEqual(items(trimmed.request),[user('current')]);
 assert.equal(trimmed.request.previousResponseId,'provider-response');assert.equal(trimmed.request.conversationId,'provider-conversation');
 const remote={type:'item_reference',id:'remote'};
 const linked=request([user('older'.repeat(300)),assistant('old reply'),remote,user('current')],{previousResponseId:'previous'});
 assert.ok(items(trimModelRequest(linked,{maxInputChars:600}).request).some(item=>item.type==='item_reference'&&item.id==='remote'));
});

test('current user, system messages, pending calls and newest result cannot be silently dropped',()=>{
 for(const input of [
  [user('x'.repeat(1500))],
  [{type:'message',role:'system',content:'x'.repeat(1500)},user('current')],
  [user('current'),call('pending','x'.repeat(1500)),assistant('latest')],
  [user('current'),result('external','short'),assistant('x'.repeat(1500))],
 ])assert.throws(()=>trimModelRequest(request(input),{maxInputChars:500}),ContextBudgetError);
});

test('a request already within bounds retains all context, signal and cache annotations',()=>{
 const controller=new AbortController();
 const input=[{type:'message',role:'user',content:[{type:'input_text',text:'current',promptCacheBreakpoint:{mode:'explicit'}}]}];
 const r=request(input,{signal:controller.signal});
 const output=trimModelRequest(r,{maxInputChars:1000});
 assert.equal(output.trimmed,false);assert.equal(output.request.signal,controller.signal);assert.deepEqual(output.request.input,input);
});

test('history helper retains recent context within the serialized limit, including escaping and Unicode',()=>{
 const messages=[{author:'user',text:'old'.repeat(5000)},{author:'scout',text:'recent answer'},{author:'user',text:'recent follow-up'}];
 const before=structuredClone(messages),context=recentConversationContext(messages,300);
 assert.ok(context.length<=300);assert.match(context,/recent answer/);assert.match(context,/recent follow-up/);assert.ok(!context.includes('oldold'));assert.deepEqual(messages,before);
 const huge=recentConversationContext([{author:'user',text:'"\\😄'.repeat(1000)}],500);
 assert.ok(huge.length<=500);assert.match(huge,/Earlier message shortened/);
 assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(JSON.parse(huge.slice(huge.indexOf('\n')+1))[0].text));
 assert.equal(recentConversationContext([],500),'');assert.equal(recentConversationContext(messages,10),'');
});

test('budget validation is explicit and errors contain no prompt or tool content',()=>{
 for(const maxInputChars of [0,-1,NaN,Infinity])assert.throws(()=>trimModelRequest(request('secret user text'),{maxInputChars}),ContextBudgetError);
 assert.throws(()=>trimModelRequest(request('do-not-expose'.repeat(100)),{maxInputChars:10}),error=>error instanceof ContextBudgetError&&!error.message.includes('do-not-expose'));
});
