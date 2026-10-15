import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTeam} from '../src/server/personas.js';
import {DemoEngine} from '../src/server/demo.js';
import {customTeam} from './personas.fixture.js';

test('teams are bounded, normalized, detached, and immutable with one bot per capability role',()=>{
 const original=customTeam();original[0].name='  Captain  ';const team=validateTeam(original)!;
 assert.equal(team[0].name,'Captain');original[0].purpose='changed';original.reverse();
 assert.equal(team[0].purpose,'Focus on coordinator clarity.');assert.equal(team[0].role,'coordinator');
 assert.ok(Object.isFrozen(team)&&team.every(Object.isFrozen));assert.throws(()=>{team[0].name='changed';});
 assert.equal(validateTeam(undefined),undefined);
});

test('malformed teams and credential-like customization cannot enter a run',()=>{
 const invalid:unknown[]=[null,{},[],customTeam().slice(0,3),[...customTeam(),customTeam()[0]]];
 for(const patch of [{id:'../bad'},{id:'x'.repeat(65)},{name:' '},{name:'x'.repeat(41)},{purpose:'x'.repeat(601)},{name:'line\ncontrol'},{purpose:'null\u0000control'},{purpose:'escape\u001bcontrol'},{purpose:'sk-'+ 'a'.repeat(40)},{name:'Bearer '+ 'a'.repeat(40)},{color:'url(https://example.com)'},{shape:'script'},{shape:['orbit']},{role:'admin'},{tools:['shell']}]){const team=customTeam();invalid.push([{...team[0],...patch},...team.slice(1)]);}
 const duplicateRole=customTeam();duplicateRole[1].role='coordinator';invalid.push(duplicateRole);
 const duplicateId=customTeam();duplicateId[1].id=duplicateId[0].id;invalid.push(duplicateId);
 for(const value of invalid)assert.throws(()=>validateTeam(value));
});

test('demo history preserves the assigned profiles while remaining a scripted fixture',()=>{
 const demo=new DemoEngine(60_000);try{
 const team=customTeam();const first=demo.start('Task one',team);demo.cancel(first.id);
 team[0].name='Replacement';const second=demo.start('Task two',team);
 assert.equal(first.team![0].name,'Bot 1');assert.equal(second.team![0].name,'Replacement');
 assert.equal(first.mode,'demo');assert.equal(first.artifacts.length,0);assert.ok(Object.isFrozen(first.team));
 }finally{demo.dispose();}
});


test('multiline purpose preserves ordinary instruction formatting without relaxing control filtering',()=>{
 const team=customTeam();team[1].purpose='Inspect first.\n\tReport findings.\r\nKeep changes small.';
 assert.equal(validateTeam(team)![1].purpose,team[1].purpose);
});


test('scripted narrative preserves custom identities through both exact approvals',async()=>{
 const demo=new DemoEngine(1);try{
 const team=customTeam();const run=demo.start('Fix tiny-project',team);team[1].name='Later change';
 const awaitStatus=async(status:string)=>{for(let i=0;i<100&&run.status!==status;i++)await delay(2);assert.equal(run.status,status);};
 await awaitStatus('awaiting_approval');
 assert.match(run.messages.find(m=>m.author==='coordinator')!.text,/Bot 1.*Bot 2.*Bot 3.*Bot 4/);
 assert.ok(run.events.some(e=>e.title==='Bot 2, take a look'&&e.agent==='custom-scout'));
 let approval=run.approvals.at(-1)!;assert.equal(approval.agent,'custom-maker');demo.decide(run.id,approval.id,approval.digest,true);
 await awaitStatus('awaiting_approval');approval=run.approvals.at(-1)!;assert.equal(approval.agent,'custom-checker');demo.decide(run.id,approval.id,approval.digest,true);
 await awaitStatus('completed');
 const final=run.messages.at(-1)!;assert.equal(final.author,'coordinator');assert.match(final.text,/Bot 2 inspected.*Bot 3 proposed.*Bot 4 checked/);assert.match(final.text,/in Details/);
 assert.doesNotMatch(JSON.stringify(run.messages)+JSON.stringify(run.events),/Later change|Scout|Maker|Checker/);
 assert.ok(run.artifacts.every(a=>a.simulated));assert.match(run.output,/SIMULATED DEMO OUTPUT/);
 }finally{demo.dispose();}
});

test('ordinary personalities share a role and are selected by unique IDs up to eight participants',async()=>{
 const {validateParticipants,validateAvailableBots}=await import('../src/server/personas.js');const primary=customTeam()[0];const agents=Array.from({length:7},(_,i)=>({...customTeam()[1],id:`personality-${i}`,role:'agent' as const,name:`Personality ${i}`}));
 assert.equal(validateParticipants([primary,...agents]).length,8);assert.equal(validateAvailableBots(agents).length,7);assert.throws(()=>validateParticipants([primary,...agents,{...agents[0],id:'ninth'}]));assert.throws(()=>validateParticipants([agents[0],agents[0]]));assert.throws(()=>validateParticipants([{...agents[0],id:'coordinator'}]));assert.throws(()=>validateParticipants([primary,{...primary,id:'other-primary'}]));
});
