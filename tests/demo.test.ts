import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {DemoEngine} from '../src/server/demo.js';
async function until(fn:()=>boolean){for(let i=0;i<50&&!fn();i++)await delay(5);assert.ok(fn());}
test('demo requires two exact approvals and labels every output simulated',async()=>{const demo=new DemoEngine(2);const r=demo.start('Fix the tiny project');await until(()=>r.status==='awaiting_approval');assert.equal(r.artifacts.length,0);const a=r.approvals[0];assert.throws(()=>demo.decide(r.id,a.id,'wrong',true),/stale/);demo.decide(r.id,a.id,a.digest,true);assert.throws(()=>demo.decide(r.id,a.id,a.digest,true),/stale/);await until(()=>r.approvals.length===2);const b=r.approvals[1];demo.decide(r.id,b.id,b.digest,true);await until(()=>r.status==='completed');assert.match(r.output,/SIMULATED DEMO OUTPUT/);assert.equal(r.artifacts.length,1);assert.equal(r.artifacts[0].simulated,true);demo.dispose();});
test('decline performs no edit and cannot be replayed',async()=>{const demo=new DemoEngine(1);const r=demo.start('Fix');await until(()=>r.status==='awaiting_approval');const a=r.approvals[0];demo.decide(r.id,a.id,a.digest,false);assert.equal(r.status,'denied');assert.equal(r.artifacts.length,0);assert.throws(()=>demo.decide(r.id,a.id,a.digest,true));demo.dispose();});
test('stop cancels queued callbacks and invalidates pending decisions',async()=>{const demo=new DemoEngine(2);const r=demo.start('Fix');demo.cancel(r.id);await delay(15);assert.equal(r.status,'cancelled');assert.equal(r.approvals.length,0);const r2=demo.start('Again');await until(()=>r2.status==='awaiting_approval');const a=r2.approvals[0];demo.cancel(r2.id);assert.throws(()=>demo.decide(r2.id,a.id,a.digest,true));demo.dispose();});
test('new process-like engine cannot resume old approvals',async()=>{const demo=new DemoEngine(1);const r=demo.start('Fix');await until(()=>r.status==='awaiting_approval');const a=r.approvals[0];const restarted=new DemoEngine(1);assert.throws(()=>restarted.decide(r.id,a.id,a.digest,true),/restart/);demo.dispose();restarted.dispose();});

test('direct read-only demo chats never invent participants or mutation requests',async()=>{
 const {customTeam}=await import('./personas.fixture.js');const demo=new DemoEngine(1);
 try{for(const role of ['scout','coordinator'] as const){
  const r=demo.start('Teach me this fixture',customTeam().filter(p=>p.role===role));await until(()=>r.status==='completed');
  assert.ok(r.messages.every(m=>m.author==='user'||m.author===role));
  assert.ok(r.events.every(e=>e.agent===role));assert.equal(r.approvals.length,0);assert.equal(r.artifacts.length,0);
 }}finally{demo.dispose();}
});

test('parallel direct demos keep approvals, participants, and artifacts separate',async()=>{
 const {customTeam}=await import('./personas.fixture.js');const demo=new DemoEngine(1);
 try{
  const maker=demo.start('Propose the fix',customTeam().filter(p=>p.role==='maker'));
  const checker=demo.start('Check the original',customTeam().filter(p=>p.role==='checker'));
  await until(()=>maker.status==='awaiting_approval'&&checker.status==='awaiting_approval');
  const edit=maker.approvals[0],command=checker.approvals[0];
  assert.equal(edit.agent,'maker');assert.equal(command.agent,'checker');
  assert.throws(()=>demo.decide(checker.id,edit.id,edit.digest,true));
  demo.decide(maker.id,edit.id,edit.digest,true);await until(()=>maker.status==='completed');
  assert.equal(maker.artifacts.length,1);assert.equal(maker.approvals.length,1);assert.equal(maker.output,'');
  assert.equal(checker.artifacts.length,0);assert.equal(checker.status,'awaiting_approval');
  demo.decide(checker.id,command.id,command.digest,true);await until(()=>checker.status==='completed');
  assert.match(checker.output,/exit code 1/);assert.equal(checker.artifacts.length,0);
  assert.ok(maker.messages.every(m=>m.author==='user'||m.author==='maker'));
  assert.ok(checker.messages.every(m=>m.author==='user'||m.author==='checker'));
 }finally{demo.dispose();}
});

test('a selected group works without introducing a coordinator or an absent scout',async()=>{
 const {customTeam}=await import('./personas.fixture.js');const demo=new DemoEngine(1);
 try{
  const r=demo.start('Build and check',customTeam().filter(p=>p.role==='maker'||p.role==='checker'));
  await until(()=>r.status==='awaiting_approval');let a=r.approvals.at(-1)!;demo.decide(r.id,a.id,a.digest,true);
  await until(()=>r.approvals.length===2);a=r.approvals.at(-1)!;demo.decide(r.id,a.id,a.digest,true);
  await until(()=>r.status==='completed');assert.match(r.output,/pass 3/);
  assert.ok(r.messages.every(m=>['user','maker','checker'].includes(m.author)));
  assert.ok(r.events.every(e=>['maker','checker'].includes(e.agent)));
 }finally{demo.dispose();}
});

test('primary demo starts a specialist group from its roster without inventing direct-chat participants',async()=>{
 const {customTeam}=await import('./personas.fixture.js');const team=customTeam();const requests:{runId:string;botIds:string[];brief:string}[]=[];
 const demo=new DemoEngine(1,async(runId,request)=>{requests.push({runId,...request});return {conversationId:'child-group',title:request.title};});
 try{
  const parent=demo.start('Help me fix the failing tests in tiny-project.',team.filter(p=>p.role==='coordinator'),{availableBots:team.filter(p=>p.role!=='coordinator')});
  await until(()=>parent.status==='completed');assert.equal(requests.length,1);assert.equal(requests[0].runId,parent.id);
  assert.deepEqual(requests[0].botIds,team.filter(p=>p.role!=='coordinator').map(p=>p.id));
  assert.ok(parent.messages.every(m=>m.author==='user'||m.author==='coordinator'));assert.equal(parent.approvals.length,0);
  const group=demo.start(requests[0].brief,team,{promptAuthor:'coordinator'});
  await until(()=>group.status==='awaiting_approval');assert.equal(group.messages[0].author,'coordinator');assert.equal(requests.length,1);
  assert.equal(parent.status,'completed');assert.equal(parent.artifacts.length,0);
 }finally{demo.dispose();}
});

test('primary greetings and explicit direct-only requests do not start a group',async()=>{
 const {customTeam}=await import('./personas.fixture.js');const team=customTeam();let created=0;
 const demo=new DemoEngine(1,async()=>{created++;return {conversationId:'unexpected',title:'Unexpected'};});
 try{for(const prompt of ['Hello','Explain the test; do not start a group.']){
  const run=demo.start(prompt,team.filter(p=>p.role==='coordinator'),{availableBots:team.filter(p=>p.role!=='coordinator')});
  await until(()=>run.status==='completed');assert.equal(run.approvals.length,0);
 }assert.equal(created,0);}finally{demo.dispose();}
});

test('stopping a primary demo before its decision cannot create a group',async()=>{
 const {customTeam}=await import('./personas.fixture.js');const team=customTeam();let created=0;
 const demo=new DemoEngine(2,async()=>{created++;return {conversationId:'unexpected',title:'Unexpected'};});
 try{const run=demo.start('Fix the tests',team.filter(p=>p.role==='coordinator'),{availableBots:team.filter(p=>p.role!=='coordinator')});demo.cancel(run.id);await delay(15);assert.equal(created,0);assert.equal(run.status,'cancelled');}finally{demo.dispose();}
});

test('group creation failure does not claim success or request an action in the primary chat',async()=>{
 const {customTeam}=await import('./personas.fixture.js');const team=customTeam();
 const demo=new DemoEngine(1,async()=>{throw new Error('private failure detail');});
 try{const run=demo.start('Fix the tests',team.filter(p=>p.role==='coordinator'),{availableBots:team.filter(p=>p.role!=='coordinator')});await until(()=>run.status==='failed');assert.equal(run.approvals.length,0);assert.doesNotMatch(JSON.stringify(run),/private failure detail/);}finally{demo.dispose();}
});


test('primary demo saves a named personality through the server callback without model or project actions',async()=>{
 const {customTeam}=await import('./personas.fixture.js');const team=customTeam();const requests:unknown[]=[];
 const demo=new DemoEngine(1,undefined,async(runId,request)=>{requests.push({runId,...request});return {...team.find(p=>p.role==='scout')!,id:'new-ada',...request};});
 try{
  const run=demo.start('Create a patient Python tutor called Ada.',team.filter(p=>p.role==='coordinator'),{availableBots:[]});
  await until(()=>run.status==='completed');assert.deepEqual(requests,[{runId:run.id,name:'Ada',purpose:'Act as a patient Python tutor.',role:'scout'}]);
  assert.equal(run.approvals.length,0);assert.equal(run.artifacts.length,0);assert.equal(run.output,'');assert.match(run.messages.at(-1)!.text,/scripted example saved Ada/);
  const direct=demo.start('Create a patient Python tutor called Extra.',team.filter(p=>p.role==='scout'));
  await until(()=>direct.status==='completed');assert.equal(requests.length,1);
 }finally{demo.dispose();}
});

test('stopped and failed demo creations cannot claim a saved agent',async()=>{
 const {customTeam}=await import('./personas.fixture.js');const team=customTeam();let calls=0;
 const demo=new DemoEngine(2,undefined,async()=>{calls++;throw new Error('private creation failure');});
 try{
  const stopped=demo.start('Create a Python tutor called Ada.',team.filter(p=>p.role==='coordinator'),{availableBots:[]});demo.cancel(stopped.id);await delay(15);assert.equal(calls,0);
  const failed=demo.start('Create a Python tutor called Ada.',team.filter(p=>p.role==='coordinator'),{availableBots:[]});await until(()=>failed.status==='failed');assert.equal(calls,1);
  assert.doesNotMatch(JSON.stringify(failed),/private creation failure|scripted example saved/);assert.equal(failed.approvals.length,0);
 }finally{demo.dispose();}
});
