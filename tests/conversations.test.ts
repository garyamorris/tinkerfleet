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

test('coordinator group selection is confined to a frozen specialist roster and active direct source',async()=>{
 const {validateAvailableBots}=await import('../src/server/personas.js');const {selectCoordinatorGroup}=await import('../src/server/conversations.js');
 const profiles=customTeam(),alternate={...profiles[1],id:'alternate-scout',name:'Alternative'};
 const source:Conversation={...chat('source'),participants:[profiles[0]],availableBots:validateAvailableBots([...profiles.slice(1),alternate]),currentRunId:'origin-run'};
 const origin:Run={...run('origin-run','source'),team:[profiles[0]],status:'running'};
 const request={title:'Focused group',brief:'Share only this task.',botIds:[profiles[1].id,profiles[2].id]};
 const selected=selectCoordinatorGroup(source,origin,request);assert.deepEqual(selected.participants.map(p=>p.role),['coordinator','scout','maker']);assert.ok(Object.isFrozen(selected.participants));
 for(const invalid of [{...request,botIds:[]},{...request,botIds:['unlisted']},{...request,botIds:[profiles[1].id,profiles[1].id]},{...request,botIds:[profiles[0].id]},{...request,title:'x'.repeat(81)},{...request,brief:'x'.repeat(8001)}])assert.throws(()=>selectCoordinatorGroup(source,origin,invalid));
 assert.throws(()=>selectCoordinatorGroup(source,{...origin,status:'cancelled'},request));assert.throws(()=>selectCoordinatorGroup({...source,participants:[profiles[1]]},origin,request));
 const secret='sk-'+ 'a'.repeat(40);assert.equal(selectCoordinatorGroup(source,origin,{...request,brief:secret}).brief,'[REDACTED]');
 assert.throws(()=>validateAvailableBots([profiles[0]]));assert.throws(()=>validateAvailableBots([profiles[1],profiles[1]]));assert.throws(()=>validateAvailableBots(Array.from({length:33},(_,i)=>({...profiles[1],id:`bot-${i}`}))));
 assert.equal(validateAvailableBots([profiles[1],alternate]).length,2);assert.equal(selectCoordinatorGroup(source,origin,{...request,botIds:[profiles[1].id,alternate.id]}).participants.length,3);
});

test('group provenance and source links persist; forged origins, rosters, and duplicate creations are rejected',t=>{
 const directory=mkdtempSync(path.join(tmpdir(),'tinkerfleet-group-state-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const file=path.join(directory,'state.json');
 const profiles=customTeam(),brief='Only a task brief.';
 const source:Conversation={...chat('source'),participants:[profiles[0]],availableBots:profiles.slice(1),currentRunId:'origin-run'};
 const origin:Run={...run('origin-run','source'),team:[profiles[0]],messages:[{id:'source-message',author:'coordinator',text:'Started group',conversationId:'child',at:2}]};
 const group:Conversation={...chat('child'),participants:profiles,startedBy:{conversationId:'source',runId:'origin-run',coordinatorId:profiles[0].id,brief},currentRunId:'child-run'};
 const child:Run={...run('child-run','child'),team:profiles,prompt:brief,messages:[{id:'brief',author:'coordinator',text:brief,at:2}]};
 const state={version:1 as const,conversations:[source,group],runs:[origin,child]};
 const store=new ConversationStore(file);store.save(state.conversations,state.runs);const restored=new ConversationStore(file).state;assert.deepEqual(restored,{...state,profiles:[],libraryImported:false});
 const invalids=[
  {...state,conversations:[source,{...group,startedBy:{...group.startedBy!,runId:'child-run'}}]},
  {...state,conversations:[{...source,availableBots:[]},group]},
  {...state,conversations:[source,{...group,availableBots:profiles.slice(1)}]},
  {...state,conversations:[source,group,{...group,id:'duplicate-child',currentRunId:null}]},
  {...state,runs:[{...origin,messages:[{...origin.messages[0],conversationId:'source'}]},child]},
 ];
 for(const invalid of invalids){writeFileSync(file,JSON.stringify(invalid));assert.throws(()=>new ConversationStore(file),/left unchanged/);}
});

test('library stores profile edits separately from immutable conversation identities and rejects invalid libraries',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'tinkerfleet-profile-store-')),file=path.join(directory,'state.json');
 try{
 const original=customTeam()[0],savedRun=run('profile-run','profile-chat');savedRun.team=[original];
 const chat={id:'profile-chat',title:'Original',participants:[original],createdAt:1,updatedAt:1,draft:'',currentRunId:savedRun.id};
 writeFileSync(file,JSON.stringify({version:1,conversations:[chat],runs:[savedRun]}));const store=new ConversationStore(file);assert.equal(store.state.libraryImported,false);assert.equal(store.state.profiles[0].name,original.name);
 const revised={...original,name:'Revised library identity'};store.save([chat],[savedRun],[revised],true);const restored=new ConversationStore(file).state;assert.equal(restored.libraryImported,true);assert.equal(restored.profiles[0].name,revised.name);assert.equal(restored.conversations[0].participants[0].name,original.name);
 assert.throws(()=>store.save([chat],[savedRun],[revised,revised],true));
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('oversized legacy library migration fails without silently discarding profiles or replacing saved history',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'tinkerfleet-legacy-cap-')),file=path.join(directory,'state.json');
 try{const chats=Array.from({length:33},(_,i)=>({...chat(`legacy-${i}`),currentRunId:null,participants:[{...customTeam()[1],id:`legacy-bot-${i}`}]}));const source=JSON.stringify({version:1,conversations:chats,runs:[]});writeFileSync(file,source);assert.throws(()=>new ConversationStore(file),/more than 32 bot profiles.*left unchanged/);assert.equal(readFileSync(file,'utf8'),source);}finally{rmSync(directory,{recursive:true,force:true});}
});

test('saved message citations retain safe inline links and discard unsafe URL authority',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'tinkerfleet-citations-')),file=path.join(directory,'state.json');
 try{const item=run();item.messages[0].text='Supported claim';item.messages[0].sources=[{url:'https://example.com/evidence',title:'Evidence',startIndex:0,endIndex:9},{url:'javascript:alert(1)',title:'Unsafe'}];const store=new ConversationStore(file);store.save([chat()],[item]);const sources=new ConversationStore(file).state.runs[0].messages[0].sources;assert.deepEqual(sources,[{url:'https://example.com/evidence',title:'Evidence',startIndex:0,endIndex:9}]);}finally{rmSync(directory,{recursive:true,force:true});}
});

test('direct agent delivery and replies persist by identity and reject forged source ownership',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'tinkerfleet-direct-provenance-')),file=path.join(directory,'state.json');
 try{
 const primary=customTeam()[0],agent={...customTeam()[1],id:'writer-ada',role:'agent' as const};
 const source:Conversation={...chat('primary'),participants:[primary],availableBots:[agent],currentRunId:'source-run'},recipient:Conversation={...chat('recipient'),participants:[agent],currentRunId:'recipient-run'};
 const sourceRun:Run={...run('source-run',source.id),team:[primary],messages:[{id:'delivery',author:'coordinator',text:'Delivered',conversationId:recipient.id,recipientRunId:'recipient-run',at:2},{id:'reply',author:agent.id,text:'Ada replied',replyToRunId:'recipient-run',at:3}]};
 const recipientRun:Run={...run('recipient-run',recipient.id),team:[agent],sentBy:{conversationId:source.id,runId:sourceRun.id,coordinatorId:primary.id},messages:[{id:'brief',author:'coordinator',text:'Explicit message',at:2},{id:'answer',author:agent.id,text:'Ada replied',at:3}]};
 const store=new ConversationStore(file);store.save([source,recipient],[sourceRun,recipientRun]);const restored=new ConversationStore(file).state;assert.equal(restored.runs[1].messages[1].author,agent.id);assert.equal(restored.runs[0].messages[1].replyToRunId,recipientRun.id);
 assert.throws(()=>store.save([source,recipient],[sourceRun,{...recipientRun,sentBy:{...recipientRun.sentBy!,runId:'foreign'}}]));
 assert.throws(()=>store.save([source,recipient],[{...sourceRun,messages:[{...sourceRun.messages[1],author:'different-agent'}]},recipientRun]));
 assert.throws(()=>store.save([{...source,availableBots:[]},recipient],[sourceRun,recipientRun]));
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('created agent links open only the matching direct conversation while old unlinked creation records remain readable',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'tinkerfleet-created-link-')),file=path.join(directory,'state.json');
 try{
 const primary=customTeam()[0],agent={...customTeam()[1],id:'new-agent',role:'agent' as const};const source:Conversation={...chat('source'),participants:[primary],availableBots:[agent],currentRunId:'creation-run'},direct:Conversation={...chat('direct'),participants:[agent],currentRunId:null};
 const creation:Run={...run('creation-run',source.id),team:[primary],messages:[{id:'created',author:'coordinator',createdAgentId:agent.id,conversationId:direct.id,text:'Created the agent',at:2}]};
 const store=new ConversationStore(file);store.save([source,direct],[creation],[],true);const restored=new ConversationStore(file).state;assert.equal(restored.runs[0].messages[0].conversationId,direct.id);assert.equal(restored.profiles.length,0,'Deleting a library profile must not break its historical link.');
 const altered=(patch:Partial<typeof creation.messages[0]>):Run=>({...creation,messages:[{...creation.messages[0],...patch}]});
 assert.throws(()=>store.save([source,direct],[altered({createdAgentId:'another-agent'})]));assert.throws(()=>store.save([source,direct],[altered({author:agent.id})]));assert.throws(()=>store.save([source,direct],[altered({recipientRunId:'forged'})]));assert.throws(()=>store.save([source,direct],[altered({conversationId:source.id})]));
 assert.throws(()=>store.save([{...source,availableBots:[]},direct],[creation]));assert.throws(()=>store.save([source,{...direct,participants:[{...agent,purpose:'Different frozen identity'}]}],[creation]));
 const legacy=altered({conversationId:undefined});store.save([source],[legacy]);assert.equal(new ConversationStore(file).state.runs[0].messages[0].createdAgentId,agent.id);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
