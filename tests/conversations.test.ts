import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,statSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ConversationStore,conversationHistory,CONVERSATION_LIMITS} from '../src/server/conversations.js';
import {validateParticipants,validateTeam} from '../src/server/personas.js';
import {customTeam} from './personas.fixture.js';
import type {Conversation,Run} from '../src/shared/types.js';
const chat=(id='chat-a'):Conversation=>({id,title:'Research',participants:customTeam().slice(1,2),createdAt:1,updatedAt:2,draft:'A private draft',currentRunId:'run-a'});
const run=(id='run-a',conversationId='chat-a'):Run=>({id,conversationId,team:customTeam().slice(1,2),prompt:'Inspect this fixture',status:'completed',mode:'demo',messages:[{id:'message-a',author:'scout',text:'Only this conversation',at:2}],events:[],approvals:[],artifacts:[],output:'',activeAgent:null,startedAt:1,endedAt:2});

test('conversation participants support one to four distinct safe roles; legacy fleets still require four',()=>{
 const source=customTeam().slice(1,2),participants=validateParticipants(source);source[0].name='Changed';assert.equal(participants[0].name,'Bot 2');assert.ok(Object.isFrozen(participants));
 assert.throws(()=>validateTeam(participants));assert.throws(()=>validateParticipants(undefined));assert.throws(()=>validateParticipants([]));assert.throws(()=>validateParticipants([source[0],source[0]]));
});

test('history is scoped, bounded and detached from prior public runs',()=>{
 const own=run(),foreign=run('run-b','chat-b'),active=run('run-c');foreign.messages[0].text='FOREIGN';active.status='running';active.messages[0].text='IN_FLIGHT';
 const history=conversationHistory('chat-a',[own,foreign,active]);assert.deepEqual(history.map(m=>m.text),['Only this conversation']);history[0].text='changed';assert.equal(own.messages[0].text,'Only this conversation');
 own.messages=Array.from({length:60},(_,i)=>({id:`message-${i}`,author:'scout' as const,text:'x'.repeat(1000),at:i}));const bounded=conversationHistory('chat-a',[own]);assert.ok(bounded.length<=CONVERSATION_LIMITS.historyMessages);assert.ok(bounded.reduce((n,m)=>n+m.text.length,0)<=CONVERSATION_LIMITS.historyChars);
});

test('private atomic persistence stores only sanitized public views and invalidates in-flight authority on restore',t=>{
 const directory=mkdtempSync(path.join(tmpdir(),'tinkerfleet-conversations-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const file=path.join(directory,'state.json');
 const active=run();active.status='awaiting_approval';active.activeAgent='scout';active.approvals=[{id:'approval-a',digest:'a'.repeat(64),agent:'scout',title:'Review',description:'Review command',action:{kind:'command',executable:'node',args:['--test']},status:'pending'}];
 const synthetic='sk-'+ 'a'.repeat(40);active.messages[0].text=synthetic;Object.assign(active,{sdkState:{private:'not public'},grants:['never persist'],apiKey:synthetic});
 const store=new ConversationStore(file);store.save([chat()],[active]);assert.equal(statSync(file).mode&0o777,0o600);
 const serialized=readFileSync(file,'utf8');assert.ok(!serialized.includes(synthetic));assert.doesNotMatch(serialized,/sdkState|grants|apiKey/);
 const restored=new ConversationStore(file).state;assert.equal(restored.conversations[0].draft,'A private draft');assert.equal(restored.runs[0].status,'cancelled');assert.equal(restored.runs[0].activeAgent,null);assert.equal(restored.runs[0].approvals[0].status,'denied');assert.equal(restored.runs[0].messages[0].text,'[REDACTED]');
 assert.ok(Object.isFrozen(restored.conversations[0].participants));
});

test('legacy runs migrate once into separate conversations without losing completed history',t=>{
 const directory=mkdtempSync(path.join(tmpdir(),'tinkerfleet-migrate-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const file=path.join(directory,'state.json');
 const first=run(),second=run('run-b');delete first.conversationId;delete second.conversationId;delete first.team;second.status='denied';
 writeFileSync(file,JSON.stringify({runs:[first,second]}),{mode:0o600});const store=new ConversationStore(file);assert.equal(store.state.conversations.length,2);assert.notEqual(store.state.runs[0].conversationId,store.state.runs[1].conversationId);assert.deepEqual(store.state.runs.map(r=>r.status),['completed','denied']);assert.equal(store.state.runs[0].messages[0].text,'Only this conversation');
 store.save(store.state.conversations,store.state.runs);assert.deepEqual(new ConversationStore(file).state,store.state);
});

test('corrupt, oversized, linked, or cross-owned saved histories fail closed without replacement',t=>{
 const directory=mkdtempSync(path.join(tmpdir(),'tinkerfleet-corrupt-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const file=path.join(directory,'state.json');
 const unbound=run();delete unbound.conversationId;const foreignTeam=run();foreignTeam.team=customTeam().slice(2,3);
 for(const contents of [JSON.stringify({version:1,conversations:[chat()],runs:[unbound]}),JSON.stringify({version:1,conversations:[chat()],runs:[foreignTeam]}),'{broken',JSON.stringify({version:1,conversations:[chat()],runs:[run('run-a','foreign')]}),' '.repeat(CONVERSATION_LIMITS.bytes+1)]){writeFileSync(file,contents);assert.throws(()=>new ConversationStore(file),/left unchanged/);assert.equal(readFileSync(file,'utf8'),contents);}
 const alias=path.join(directory,'alias.json');symlinkSync(file,alias);assert.throws(()=>new ConversationStore(alias),/left unchanged/);
});
