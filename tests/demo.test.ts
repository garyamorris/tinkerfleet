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
