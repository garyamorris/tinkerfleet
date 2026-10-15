import {customTeam} from './personas.fixture.js';
import test from 'node:test';
import {request} from 'node:http';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createApp} from '../src/server/app.js';
async function fetch(input:string,init:RequestInit={}){const headers=new Headers(init.headers);headers.set('Connection','close');return globalThis.fetch(input,{...init,headers});}
const port=45318,origin=`http://127.0.0.1:${port}`;
test('local API authenticates same-origin sessions and exact single-use approvals',async()=>{
 const app=createApp({port,mode:'demo',demoDelayMs:1});await new Promise<void>(r=>app.server.listen(port,'127.0.0.1',r));
 try{
 const session=await fetch(origin+'/api/session');const {csrf}=await session.json() as {csrf:string};const cookie=session.headers.get('set-cookie')!.split(';')[0];
 const auth={Cookie:cookie,Origin:origin,'X-Tinkerfleet-CSRF':csrf,'Content-Type':'application/json'};
 assert.equal((await fetch(origin+'/api/state')).status,401);
 assert.equal((await fetch(origin+'/api/session',{headers:{Origin:'https://evil.example'}})).status,403);
 const hostileHost=await new Promise<number>(resolve=>{const r=request(origin+'/api/session',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode!);});r.end();});assert.equal(hostileHost,403);
 assert.equal((await fetch(origin+'/api/session',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
 assert.equal((await fetch(origin+'/api/runs',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{"prompt":"Fix"}'})).status,403);
 assert.equal((await fetch(origin+'/api/runs',{method:'POST',headers:{...auth,'X-Tinkerfleet-CSRF':'bad'},body:'{"prompt":"Fix"}'})).status,403);
 assert.equal((await fetch(origin+'/api/runs',{method:'POST',headers:{...auth,'Content-Type':'text/plain'},body:'Fix'})).status,415);
 assert.equal((await fetch(origin+'/api/runs',{method:'POST',headers:auth,body:JSON.stringify({prompt:'x'.repeat(40000)})})).status,413);
 const results=await Promise.all([1,2].map(()=>fetch(origin+'/api/runs',{method:'POST',headers:auth,body:JSON.stringify({prompt:'Fix the tiny project',team:customTeam().slice(2,3)})})));assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 const run=await results.find(r=>r.status===201)!.json() as {id:string};
 let state:any;for(let i=0;i<30;i++){state=await (await fetch(origin+'/api/state',{headers:auth})).json();if(state.runs[0].approvals.length)break;await delay(5);}
 const a=state.runs[0].approvals[0];const url=origin+`/api/runs/${run.id}/approval`;
 assert.equal((await fetch(url,{method:'POST',headers:auth,body:JSON.stringify({approvalId:a.id,digest:'bad',approved:true})})).status,409);
 assert.equal((await fetch(url,{method:'POST',headers:auth,body:JSON.stringify({approvalId:a.id,digest:a.digest,approved:'yes'})})).status,400);
 const decisions=await Promise.all([1,2].map(()=>fetch(url,{method:'POST',headers:auth,body:JSON.stringify({approvalId:a.id,digest:a.digest,approved:false})})));assert.deepEqual(decisions.map(r=>r.status).sort(),[200,409]);
 state=await (await fetch(origin+'/api/state',{headers:auth})).json();assert.equal(state.runs[0].status,'denied');assert.equal(state.runs[0].artifacts.length,0);assert.equal(state.model,null);assert.doesNotMatch(JSON.stringify(state),/OPENAI_API_KEY|sk-proj-/);
 await app.close();const restarted=createApp({port,mode:'demo'});await new Promise<void>(r=>restarted.server.listen(port,'127.0.0.1',r));try{assert.equal((await fetch(origin+'/api/state',{headers:auth})).status,401);const fresh=await fetch(origin+'/api/session');const data=await fresh.json() as {csrf:string};const freshAuth={Cookie:fresh.headers.get('set-cookie')!.split(';')[0],Origin:origin,'X-Tinkerfleet-CSRF':data.csrf,'Content-Type':'application/json'};assert.equal((await fetch(url,{method:'POST',headers:freshAuth,body:JSON.stringify({approvalId:a.id,digest:a.digest,approved:true})})).status,404);}finally{await restarted.close();}
 }finally{if(app.server.listening)await app.close();}
});
test('live startup reserves one run and remains stoppable before preflight ends',async()=>{const port=45319;const base=`http://127.0.0.1:${port}`;const app=createApp({port,mode:'live'});await new Promise<void>(r=>app.server.listen(port,'127.0.0.1',r));try{const session=await fetch(base+'/api/session');const {csrf}=await session.json() as {csrf:string};const headers={Cookie:session.headers.get('set-cookie')!.split(';')[0],Origin:base,'X-Tinkerfleet-CSRF':csrf,'Content-Type':'application/json'};const res=await fetch(base+'/api/runs',{method:'POST',headers,body:'{"prompt":"Inspect fixture"}'});assert.equal(res.status,201);const run=await res.json() as {id:string};const stopped=await fetch(base+`/api/runs/${run.id}/stop`,{method:'POST',headers,body:'{}'});assert.equal(stopped.status,200);await delay(25);const state=await (await fetch(base+'/api/state',{headers})).json() as any;assert.ok(['cancelled','failed'].includes(state.runs[0].status));assert.equal(state.liveReady,false);}finally{await app.close();}});


test('cross-site document navigation can load the public shell without opening API access',async()=>{
 const port=45320,base=`http://127.0.0.1:${port}`;
 const app=createApp({port,mode:'demo',serve:(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Tinkerfleet</title>');}});
 await new Promise<void>(resolve=>app.server.listen(port,'127.0.0.1',resolve));
 const get=(pathname:string,headers:Record<string,string>,method='GET')=>new Promise<{status:number;cookie:string[]|undefined}>(resolve=>{
  const req=request(base+pathname,{method,headers},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode!,cookie:res.headers['set-cookie']}));});req.end();
 });
 try{
  for(const site of ['cross-site','same-site']){
   const navigation={'Sec-Fetch-Site':site,'Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'};
   const shell=await get('/',navigation);assert.equal(shell.status,200);assert.equal(shell.cookie,undefined);
   assert.equal((await get('/api/session',navigation)).status,403);
   assert.equal((await get('/api/state',navigation)).status,403);
   assert.equal((await get('/assets/app.js',navigation)).status,403);
   assert.equal((await get('/',{...navigation,'Sec-Fetch-Mode':'cors'})).status,403);
   assert.equal((await get('/',{...navigation,'Sec-Fetch-Dest':'iframe'})).status,403);
   assert.equal((await get('/',navigation,'POST')).status,403);
   assert.equal((await get('/',{...navigation,Origin:'https://evil.example'})).status,403);
   assert.equal((await get('/',{...navigation,Host:'evil.example'})).status,403);
  }
 }finally{await app.close();}
});


test('HTTP validates profiles and retains historical team assignments',async()=>{
 const port=45321,base=`http://127.0.0.1:${port}`;const app=createApp({port,mode:'demo',demoDelayMs:60_000});
 await new Promise<void>(resolve=>app.server.listen(port,'127.0.0.1',resolve));
 try{
 const session=await fetch(base+'/api/session'),{csrf}=await session.json() as {csrf:string};
 const headers={Cookie:session.headers.get('set-cookie')!.split(';')[0],Origin:base,'X-Tinkerfleet-CSRF':csrf,'Content-Type':'application/json'};
 const start=(team:unknown)=>fetch(base+'/api/runs',{method:'POST',headers,body:JSON.stringify({prompt:'Custom fixture',team})});
 for(const team of [[],null,customTeam().slice(0,3),customTeam().map(p=>({...p,role:'maker'})),customTeam().map(p=>({...p,purpose:'sk-'+ 'a'.repeat(40)}))])assert.equal((await start(team)).status,400);
 assert.equal(app.state().runs.length,0);
 const team=customTeam().slice(0,1),response=await start(team);assert.equal(response.status,201);const first=await response.json() as {id:string;team:unknown};assert.deepEqual(first.team,team);
 await fetch(base+`/api/runs/${first.id}/stop`,{method:'POST',headers,body:'{}'});
 team[0].name='New Captain';assert.equal((await start(team)).status,201);
 const state=await (await fetch(base+'/api/state',{headers})).json() as {runs:{team:{name:string}[]}[]};
 assert.equal(state.runs[0].team[0].name,'Bot 1');assert.equal(state.runs[1].team[0].name,'New Captain');
 }finally{await app.close();}
});

test('independent chats isolate participants, drafts, concurrent runs and approval ownership across reloads',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
 const directory=await mkdtemp(path.join(tmpdir(),'tinkerfleet-http-chats-'));const statePath=path.join(directory,'state.json');
 const port=45322,base=`http://127.0.0.1:${port}`;let app=createApp({port,mode:'demo',demoDelayMs:1,statePath});
 const listen=()=>new Promise<void>(resolve=>app.server.listen(port,'127.0.0.1',resolve));
 let headers:Record<string,string>={};
 const session=async()=>{const response=await fetch(base+'/api/session');const {csrf}=await response.json() as {csrf:string};headers={Cookie:response.headers.get('set-cookie')!.split(';')[0],Origin:base,'X-Tinkerfleet-CSRF':csrf,'Content-Type':'application/json'};};
 const post=(url:string,body:unknown)=>fetch(base+url,{method:'POST',headers,body:JSON.stringify(body)});
 const state=async()=>await(await fetch(base+'/api/state',{headers})).json() as import('../src/shared/types.js').AppState;
 try{
 await listen();await session();
 const firstResponse=await post('/api/conversations',{title:'Maker room',participants:customTeam().slice(2,3)});assert.equal(firstResponse.status,201);const first=await firstResponse.json() as {id:string};
 const secondResponse=await post('/api/conversations',{title:'Reviewer room',participants:customTeam().slice(3,4)});assert.equal(secondResponse.status,201);const second=await secondResponse.json() as {id:string};
 const prefix=(id:string)=>`/api/conversations/${id}`;
 assert.equal((await post(prefix(first.id),{title:'Renamed maker',draft:'First draft'})).status,200);assert.equal((await post(prefix(second.id),{draft:'Second draft'})).status,200);
 assert.equal((await post(prefix(first.id),{participants:customTeam()})).status,400);
 const starts=await Promise.all([post(prefix(first.id)+'/runs',{prompt:'Maker only'}),post(prefix(second.id)+'/runs',{prompt:'Checker only'})]);assert.deepEqual(starts.map(r=>r.status),[201,201]);
 const a=await starts[0].json() as {id:string},b=await starts[1].json() as {id:string};
 assert.equal((await post(prefix(first.id)+'/runs',{prompt:'Same chat busy'})).status,409);
 let snapshot=await state();for(let i=0;i<100&&!snapshot.runs.every(r=>r.status==='awaiting_approval');i++){await delay(2);snapshot=await state();}
 const own=snapshot.runs.find(r=>r.id===a.id)!,other=snapshot.runs.find(r=>r.id===b.id)!;
 assert.deepEqual(own.team!.map(p=>p.role),['maker']);assert.deepEqual(other.team!.map(p=>p.role),['checker']);assert.equal(snapshot.conversations.find(c=>c.id===first.id)!.draft,'');
 const approval=own.approvals[0];assert.ok(approval);
 const decision={approvalId:approval.id,digest:approval.digest,approved:true};
 assert.equal((await post(prefix(second.id)+`/runs/${a.id}/approval`,decision)).status,404);
 assert.equal((await post(prefix(second.id)+`/runs/${a.id}/stop`,{})).status,404);
 assert.equal((await post(`/api/runs/${a.id}/approval`,decision)).status,404);
 assert.equal((await state()).runs.find(r=>r.id===a.id)!.approvals[0].status,'pending');
 await post(prefix(first.id),{draft:'Saved next message'});await app.close();
 app=createApp({port,mode:'demo',demoDelayMs:1,statePath});await listen();await session();snapshot=await state();
 assert.equal(snapshot.conversations.find(c=>c.id===first.id)!.title,'Renamed maker');assert.equal(snapshot.conversations.find(c=>c.id===first.id)!.draft,'Saved next message');assert.equal(snapshot.runs.find(r=>r.id===a.id)!.status,'cancelled');
 assert.equal((await post(prefix(first.id)+`/runs/${a.id}/approval`,decision)).status,409);
 assert.equal((await post(prefix(first.id)+'/runs',{prompt:'Continue this room'})).status,201);
 assert.equal((await state()).runs.filter(r=>r.conversationId===second.id).length,1);
 }finally{if(app.server.listening)await app.close();await rm(directory,{recursive:true,force:true});}
});


test('direct live chat preflight failures use its selected participant, and polling does not reorder chats',async()=>{
 const port=45323,base=`http://127.0.0.1:${port}`,app=createApp({port,mode:'live'});
 await new Promise<void>(resolve=>app.server.listen(port,'127.0.0.1',resolve));
 try{
 const session=await fetch(base+'/api/session'),{csrf}=await session.json() as {csrf:string};const headers={Cookie:session.headers.get('set-cookie')!.split(';')[0],Origin:base,'X-Tinkerfleet-CSRF':csrf,'Content-Type':'application/json'};
 const post=(url:string,body:unknown)=>fetch(base+url,{method:'POST',headers,body:JSON.stringify(body)});
 const response=await post('/api/conversations',{participants:customTeam().slice(1,2)});const chat=await response.json() as {id:string};
 assert.equal((await post(`/api/conversations/${chat.id}/runs`,{prompt:'Inspect offline fixture'})).status,201);
 let state:import('../src/shared/types.js').AppState;
 for(let i=0;i<150;i++){state=await(await fetch(base+'/api/state',{headers})).json();if(state.runs[0].status==='failed')break;await delay(10);}
 assert.equal(state!.runs[0].status,'failed');assert.deepEqual(state!.runs[0].messages.filter(m=>m.author!=='user').map(m=>m.author),['scout']);assert.ok(state!.runs[0].events.every(e=>e.agent==='scout'));
 const updatedAt=state!.conversations[0].updatedAt;await delay(5);const next=await(await fetch(base+'/api/state',{headers})).json() as import('../src/shared/types.js').AppState;assert.equal(next.conversations[0].updatedAt,updatedAt);
 }finally{await app.close();}
});


test('a history save failure during shutdown still closes the local listener',async()=>{
 const {ConversationStore}=await import('../src/server/conversations.js');
 const original=ConversationStore.prototype.save;const port=45324,app=createApp({port,mode:'demo'});
 await new Promise<void>(resolve=>app.server.listen(port,'127.0.0.1',resolve));
 try{
 ConversationStore.prototype.save=function(){throw new Error('Simulated storage failure');};
 await assert.rejects(app.close(),/could not be saved/);assert.equal(app.server.listening,false);
 }finally{ConversationStore.prototype.save=original;if(app.server.listening)await app.close();}
});

test('clients open direct chats; only a coordinator creates a linked group with brief-only context',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');const directory=await mkdtemp(path.join(tmpdir(),'tinkerfleet-primary-http-'));
 const port=45325,base=`http://127.0.0.1:${port}`,statePath=path.join(directory,'state.json');let app=createApp({port,mode:'demo',demoDelayMs:2,statePath});let headers:Record<string,string>={};
 const listen=()=>new Promise<void>(resolve=>app.server.listen(port,'127.0.0.1',resolve));
 const auth=async()=>{const response=await fetch(base+'/api/session');const {csrf}=await response.json() as {csrf:string};headers={Cookie:response.headers.get('set-cookie')!.split(';')[0],Origin:base,'X-Tinkerfleet-CSRF':csrf,'Content-Type':'application/json'};};
 const post=(url:string,body:unknown)=>fetch(base+url,{method:'POST',headers,body:JSON.stringify(body)});
 const state=async()=>await(await fetch(base+'/api/state',{headers})).json() as import('../src/shared/types.js').AppState;
 try{
 await listen();await auth();const profiles=customTeam();
 assert.equal((await post('/api/conversations',{participants:profiles})).status,400);assert.equal((await post('/api/runs',{prompt:'Bypass',team:profiles})).status,400);
 assert.equal((await post('/api/conversations',{participants:[profiles[1]],availableBots:profiles.slice(2)})).status,400);
 assert.equal((await post('/api/conversations',{participants:[profiles[0]],availableBots:[profiles[0]]})).status,400);
 assert.equal((await post('/api/conversations',{participants:[profiles[0]],startedBy:{runId:'forged'}})).status,400);
 const response=await post('/api/conversations',{title:'Private primary',participants:[profiles[0]]});assert.equal(response.status,201);const source=await response.json() as {id:string};
 const prefix=`/api/conversations/${source.id}`;
 const privateResponse=await post(prefix+'/runs',{prompt:'Hello PRIVATE_HISTORY_SENTINEL'});assert.equal(privateResponse.status,201);
 let snapshot=await state();for(let i=0;i<100&&snapshot.runs[0].status==='running';i++){await delay(3);snapshot=await state();}assert.equal(snapshot.conversations.length,1);
 assert.equal(snapshot.conversations[0].availableBots,undefined);
 const oldRunId=snapshot.runs[0].id;
 assert.equal((await post(prefix,{availableBots:profiles.slice(1)})).status,200);
 assert.equal((await post(prefix,{availableBots:profiles.slice(1)})).status,200);
 assert.equal((await post(prefix,{availableBots:[profiles[1]]})).status,409);
 assert.match((await state()).runs.find(r=>r.id===oldRunId)!.messages[0].text,/PRIVATE_HISTORY_SENTINEL/);
 const sourceResponse=await post(prefix+'/runs',{prompt:'Please fix the failing tests'});assert.equal(sourceResponse.status,201);const sourceRun=await sourceResponse.json() as {id:string};
 for(let i=0;i<100&&!snapshot.conversations.some(c=>c.startedBy);i++){await delay(3);snapshot=await state();}
 const group=snapshot.conversations.find(c=>c.startedBy)!;assert.ok(group);assert.equal(group.startedBy!.conversationId,source.id);assert.equal(group.startedBy!.runId,sourceRun.id);assert.equal(group.startedBy!.coordinatorId,profiles[0].id);assert.equal(group.availableBots,undefined);
 assert.deepEqual(group.participants.map(p=>p.id),profiles.map(p=>p.id));
 const child=snapshot.runs.find(r=>r.conversationId===group.id)!;assert.equal(child.messages[0].author,'coordinator');assert.equal(child.messages[0].text,group.startedBy!.brief);assert.doesNotMatch(JSON.stringify(child),/PRIVATE_HISTORY_SENTINEL/);
 const parent=snapshot.runs.find(r=>r.id===sourceRun.id)!;assert.equal(parent.messages.filter(m=>m.conversationId===group.id).length,1);
 assert.equal((await post(prefix+'/start-group',{title:'Forged',brief:'No',botIds:[profiles[1].id]})).status,404);
 await delay(15);snapshot=await state();assert.equal(snapshot.conversations.filter(c=>c.startedBy?.runId===sourceRun.id).length,1);assert.equal(snapshot.conversations.filter(c=>c.startedBy?.conversationId===group.id).length,0);
 await app.close();app=createApp({port,mode:'demo',statePath});await listen();await auth();snapshot=await state();assert.equal(snapshot.conversations.find(c=>c.id===group.id)!.startedBy!.runId,sourceRun.id);assert.ok(snapshot.runs.find(r=>r.id===sourceRun.id)!.messages.some(m=>m.conversationId===group.id));
 }finally{if(app.server.listening)await app.close();await rm(directory,{recursive:true,force:true});}
});


test('initial coordinator roster cannot be configured during an active run or on specialist chats',async()=>{
 const port=45326,base=`http://127.0.0.1:${port}`,app=createApp({port,mode:'demo',demoDelayMs:60_000});
 await new Promise<void>(resolve=>app.server.listen(port,'127.0.0.1',resolve));
 try{
 const response=await fetch(base+'/api/session'),{csrf}=await response.json() as {csrf:string};const headers={Cookie:response.headers.get('set-cookie')!.split(';')[0],Origin:base,'X-Tinkerfleet-CSRF':csrf,'Content-Type':'application/json'};
 const post=(url:string,body:unknown)=>fetch(base+url,{method:'POST',headers,body:JSON.stringify(body)}),profiles=customTeam();
 const created=await post('/api/conversations',{participants:[profiles[0]]}),source=await created.json() as {id:string};const prefix=`/api/conversations/${source.id}`;
 const runResponse=await post(prefix+'/runs',{prompt:'Hello'}),run=await runResponse.json() as {id:string};
 assert.equal((await post(prefix,{availableBots:profiles.slice(1)})).status,409);assert.equal(app.state().conversations[0].availableBots,undefined);
 await post(prefix+`/runs/${run.id}/stop`,{});assert.equal((await post(prefix,{availableBots:profiles.slice(1)})).status,200);
 const specialistResponse=await post('/api/conversations',{participants:[profiles[1]]}),specialist=await specialistResponse.json() as {id:string};assert.equal((await post(`/api/conversations/${specialist.id}`,{availableBots:[profiles[2]]})).status,400);
 }finally{await app.close();}
});


test('shutdown cancels live runs waiting on preflight before a late result can start the SDK',async()=>{
 const {SafeContainerRunner}=await import('../src/server/runner.js');
 const originalProbe=SafeContainerRunner.prototype.checkAvailability,originalSnapshot=SafeContainerRunner.prototype.snapshot;
 let release!:()=>void,probeSeen!:()=>void;const entered=new Promise<void>(resolve=>{probeSeen=resolve;});
 let snapshots=0;
 SafeContainerRunner.prototype.checkAvailability=async()=>{probeSeen();await new Promise<void>(resolve=>{release=resolve;});return {available:true,image:'sha256:'+ 'a'.repeat(64)};};
 SafeContainerRunner.prototype.snapshot=async function(id){snapshots++;return originalSnapshot.call(this,id);};
 const port=45327,base=`http://127.0.0.1:${port}`,app=createApp({port,mode:'live'});
 await new Promise<void>(resolve=>app.server.listen(port,'127.0.0.1',resolve));
 try{
 const session=await fetch(base+'/api/session'),{csrf}=await session.json() as {csrf:string};const headers={Cookie:session.headers.get('set-cookie')!.split(';')[0],Origin:base,'X-Tinkerfleet-CSRF':csrf,'Content-Type':'application/json'};
 const response=await fetch(base+'/api/runs',{method:'POST',headers,body:JSON.stringify({prompt:'Inspect fixture'})});assert.equal(response.status,201);await entered;
 const shutdown=app.close();assert.equal(app.state().runs[0].status,'cancelled');assert.equal(app.state().runs[0].activeAgent,null);assert.ok(app.state().runs[0].endedAt);
 release();await shutdown;await delay(5);
 assert.equal(snapshots,0);assert.equal(app.state().runs[0].status,'cancelled');assert.equal(app.server.listening,false);
 assert.ok(!app.state().runs[0].events.some(e=>e.title==='Run started'));
 }finally{release?.();SafeContainerRunner.prototype.checkAvailability=originalProbe;SafeContainerRunner.prototype.snapshot=originalSnapshot;if(app.server.listening)await app.close();}
});


test('failed group publication cannot leave a durable child without its source link',async()=>{
 const {ConversationStore}=await import('../src/server/conversations.js');const {mkdtemp,readFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
 const directory=await mkdtemp(path.join(tmpdir(),'tinkerfleet-atomic-group-')),statePath=path.join(directory,'state.json');
 const original=ConversationStore.prototype.save;let diskFailed=false,groupWrites=0,stagedTogether=false;
 const port=45328,base=`http://127.0.0.1:${port}`,app=createApp({port,mode:'demo',demoDelayMs:2,statePath});
 await new Promise<void>(resolve=>app.server.listen(port,'127.0.0.1',resolve));
 try{
 const session=await fetch(base+'/api/session'),{csrf}=await session.json() as {csrf:string};const headers={Cookie:session.headers.get('set-cookie')!.split(';')[0],Origin:base,'X-Tinkerfleet-CSRF':csrf,'Content-Type':'application/json'};
 const post=(url:string,body:unknown)=>fetch(base+url,{method:'POST',headers,body:JSON.stringify(body)}),profiles=customTeam();
 const response=await post('/api/conversations',{participants:[profiles[0]],availableBots:profiles.slice(1)}),source=await response.json() as {id:string};
 ConversationStore.prototype.save=function(chats,runs){
  const group=chats.find(c=>c.startedBy);
  if(group){groupWrites++;stagedTogether=!!runs.find(r=>r.conversationId===group.id)&&!!runs.find(r=>r.id===group.startedBy!.runId)?.messages.some(m=>m.conversationId===group.id);diskFailed=true;}
  if(diskFailed)throw new Error('Simulated disk full, including rollback');
  return original.call(this,chats,runs);
 };
 assert.equal((await post(`/api/conversations/${source.id}/runs`,{prompt:'Fix failing tests with a team'})).status,201);
 for(let i=0;i<100&&app.state().runs[0].status==='running';i++)await delay(3);
 assert.equal(app.state().runs[0].status,'failed');assert.equal(groupWrites,1);assert.equal(stagedTogether,true);
 assert.equal(app.state().conversations.length,1);assert.equal(app.state().runs.length,1);assert.ok(app.state().runs[0].messages.every(m=>!m.conversationId));
 const saved=JSON.parse(await readFile(statePath,'utf8'));assert.equal(saved.conversations.length,1);assert.equal(saved.runs.length,1);assert.ok(saved.runs[0].messages.every((m:{conversationId?:string})=>!m.conversationId));
 }finally{ConversationStore.prototype.save=original;await app.close();await rm(directory,{recursive:true,force:true});}
});
