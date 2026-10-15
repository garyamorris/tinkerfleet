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
 const port=45323,base=`http://127.0.0.1:${port}`,app=createApp({port,mode:'live',workspaceToolsEnabled:true});
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
 const {NativeWorkspaceRunner}=await import('../src/server/native-runner.js');
 const originalProbe=NativeWorkspaceRunner.prototype.checkAvailability,originalSnapshot=NativeWorkspaceRunner.prototype.snapshot;
 const releases:Array<()=>void>=[];let probeSeen!:()=>void;const release=()=>releases.forEach(resolve=>resolve());const entered=new Promise<void>(resolve=>{probeSeen=resolve;});
 let snapshots=0;
 NativeWorkspaceRunner.prototype.checkAvailability=async()=>{probeSeen();await new Promise<void>(resolve=>{releases.push(resolve);});return {available:true};};
 NativeWorkspaceRunner.prototype.snapshot=async function(id){snapshots++;return originalSnapshot.call(this,id);};
 const port=45327,base=`http://127.0.0.1:${port}`,app=createApp({port,mode:'live',workspaceToolsEnabled:true});
 await new Promise<void>(resolve=>app.server.listen(port,'127.0.0.1',resolve));
 try{
 const session=await fetch(base+'/api/session'),{csrf}=await session.json() as {csrf:string};const headers={Cookie:session.headers.get('set-cookie')!.split(';')[0],Origin:base,'X-Tinkerfleet-CSRF':csrf,'Content-Type':'application/json'};
 const response=await fetch(base+'/api/runs',{method:'POST',headers,body:JSON.stringify({prompt:'Inspect fixture'})});assert.equal(response.status,201);await entered;
 const shutdown=app.close();assert.equal(app.state().runs[0].status,'cancelled');assert.equal(app.state().runs[0].activeAgent,null);assert.ok(app.state().runs[0].endedAt);
 release();await shutdown;await delay(5);
 assert.equal(snapshots,0);assert.equal(app.state().runs[0].status,'cancelled');assert.equal(app.server.listening,false);
 assert.ok(!app.state().runs[0].events.some(e=>e.title==='Run started'));
 }finally{release?.();NativeWorkspaceRunner.prototype.checkAvailability=originalProbe;NativeWorkspaceRunner.prototype.snapshot=originalSnapshot;if(app.server.listening)await app.close();}
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

test('chat-only live HTTP uses the SDK without workspace access and preserves actual usage',async()=>{
 const {ScriptedModel,assistantMessage}=await import('@openai/agents/testing');const {Usage}=await import('@openai/agents');
 const {NativeWorkspaceRunner}=await import('../src/server/native-runner.js');
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
 const directory=await mkdtemp(path.join(tmpdir(),'tinkerfleet-chat-only-')),statePath=path.join(directory,'state.json');
 const probe=NativeWorkspaceRunner.prototype.checkAvailability,snapshot=NativeWorkspaceRunner.prototype.snapshot;let workspaceCalls=0;
 NativeWorkspaceRunner.prototype.checkAvailability=async()=>{workspaceCalls++;throw Error('Workspace forbidden');};NativeWorkspaceRunner.prototype.snapshot=async()=>{workspaceCalls++;throw Error('Workspace forbidden');};
 const citedMessage=assistantMessage('An offline verified conversation reply.');citedMessage.content[0].providerData={annotations:[{type:'url_citation',url:'https://example.com/info',title:'Example',start_index:3,end_index:10}]};
 const model=new ScriptedModel([{output:[citedMessage],usage:new Usage({inputTokens:17,outputTokens:9,totalTokens:26})}]);
 const port=45329,base=`http://127.0.0.1:${port}`;let app=createApp({port,mode:'live',sdkModel:model,workspaceToolsEnabled:false,workspaceRoot:'/does-not-exist/tinkerfleet',statePath,sdkLimits:{maxModelCalls:1,maxOutputTokens:512}});
 await new Promise<void>(resolve=>app.server.listen(port,'127.0.0.1',resolve));
 try{
 assert.equal(app.state().liveReady,true);assert.equal(app.state().webSearchEnabled,true);assert.equal(app.state().workspaceToolsEnabled,false);
 const session=await fetch(base+'/api/session'),{csrf}=await session.json() as {csrf:string};const headers={Cookie:session.headers.get('set-cookie')!.split(';')[0],Origin:base,'X-Tinkerfleet-CSRF':csrf,'Content-Type':'application/json'};
 const post=(url:string,body:unknown)=>fetch(base+url,{method:'POST',headers,body:JSON.stringify(body)});
 const chat=await(await post('/api/conversations',{participants:[customTeam()[1]]})).json() as {id:string};
 const response=await post(`/api/conversations/${chat.id}/runs`,{prompt:'Explain addition'});assert.equal(response.status,201);const run=await response.json() as {id:string};
 for(let i=0;i<100&&app.state().runs[0].status==='running';i++)await delay(3);
 assert.equal(app.state().runs[0].status,'completed');assert.match(app.state().runs[0].messages.at(-1)!.text,/offline verified/);
 assert.deepEqual(app.state().runs[0].usage,{modelCalls:1,inputTokens:17,outputTokens:9,totalTokens:26});assert.deepEqual(app.state().runs[0].messages.at(-1)!.sources,[{url:'https://example.com/info',title:'Example',startIndex:3,endIndex:10}]);
 assert.equal((await post(`/api/conversations/${chat.id}/runs/${run.id}/approval`,{approvalId:'forged',digest:'forged',approved:true})).status,409);
 await app.close();assert.equal(workspaceCalls,0);
 app=createApp({port,mode:'demo',statePath,workspaceToolsEnabled:false});assert.equal(app.state().webSearchEnabled,false);assert.deepEqual(app.state().runs[0].usage,{modelCalls:1,inputTokens:17,outputTokens:9,totalTokens:26});assert.deepEqual(app.state().runs[0].messages.at(-1)!.sources,[{url:'https://example.com/info',title:'Example',startIndex:3,endIndex:10}]);
 }finally{NativeWorkspaceRunner.prototype.checkAvailability=probe;NativeWorkspaceRunner.prototype.snapshot=snapshot;await app.close();await rm(directory,{recursive:true,force:true});}
});

test('enabled workspace fails closed before any model call if the selected folder is unavailable',async()=>{
 const {ScriptedModel}=await import('@openai/agents/testing');const {NativeWorkspaceRunner}=await import('../src/server/native-runner.js');
 const original=NativeWorkspaceRunner.prototype.checkAvailability;NativeWorkspaceRunner.prototype.checkAvailability=async()=>({available:false,reason:'Selected folder unavailable'});
 const model=new ScriptedModel([]),port=45330,base=`http://127.0.0.1:${port}`,app=createApp({port,mode:'live',sdkModel:model,workspaceToolsEnabled:true});
 await new Promise<void>(resolve=>app.server.listen(port,'127.0.0.1',resolve));
 try{
 const session=await fetch(base+'/api/session'),{csrf}=await session.json() as {csrf:string};const headers={Cookie:session.headers.get('set-cookie')!.split(';')[0],Origin:base,'X-Tinkerfleet-CSRF':csrf,'Content-Type':'application/json'};
 assert.equal((await fetch(base+'/api/runs',{method:'POST',headers,body:JSON.stringify({prompt:'Inspect the selected folder'})})).status,201);
 for(let i=0;i<100&&app.state().runs[0].status==='running';i++)await delay(3);
 assert.equal(app.state().runs[0].status,'failed');assert.equal(app.state().execution.available,false);assert.equal(app.state().liveReady,false);assert.equal(model.calls.length,0);
 }finally{NativeWorkspaceRunner.prototype.checkAvailability=original;await app.close();}
});

test('chat-only coordinator can start an isolated live group without workspace tools',async()=>{
 const {ScriptedModel,assistantMessage,functionCall}=await import('@openai/agents/testing');const profiles=customTeam();
 const model=new ScriptedModel([[functionCall('start_group_conversation',{title:'Planning group',brief:'Discuss addition using supplied information.',botIds:[profiles[1].id]},{callId:'create-group'})],[assistantMessage('The group can discuss this without files.')],[assistantMessage('The planning group is ready.')]]);
 const port=45331,base=`http://127.0.0.1:${port}`,app=createApp({port,mode:'live',sdkModel:model,workspaceToolsEnabled:false,workspaceRoot:'/does-not-exist/tinkerfleet'});
 await new Promise<void>(resolve=>app.server.listen(port,'127.0.0.1',resolve));
 try{
 const session=await fetch(base+'/api/session'),{csrf}=await session.json() as {csrf:string};const headers={Cookie:session.headers.get('set-cookie')!.split(';')[0],Origin:base,'X-Tinkerfleet-CSRF':csrf,'Content-Type':'application/json'};
 const post=(url:string,body:unknown)=>fetch(base+url,{method:'POST',headers,body:JSON.stringify(body)});
 const chat=await(await post('/api/conversations',{participants:[profiles[0]],availableBots:[profiles[1]]})).json() as {id:string};
 assert.equal((await post(`/api/conversations/${chat.id}/runs`,{prompt:'Discuss addition with a specialist'})).status,201);
 for(let i=0;i<100&&(app.state().runs.length<2||app.state().runs.some(r=>r.status==='running'));i++)await delay(3);
 const state=app.state(),group=state.conversations.find(c=>c.startedBy);assert.ok(group);assert.equal(state.runs.length,2);assert.ok(state.runs.every(r=>r.status==='completed'));assert.equal(group.availableBots,undefined);
 assert.equal(state.runs.find(r=>r.conversationId===group.id)!.messages[0].author,'coordinator');assert.equal(state.runs.find(r=>r.conversationId===chat.id)!.messages.filter(m=>m.conversationId===group.id).length,1);
 assert.equal(state.runs.reduce((n,r)=>n+(r.usage?.modelCalls??0),0),3);
 }finally{await app.close();}
});

test('HTTP exact approvals bind scripted SDK actions to real local edits and test execution',async()=>{
 const {ScriptedModel,assistantMessage,functionCall}=await import('@openai/agents/testing');
 const {mkdtemp,realpath,mkdir,writeFile,readFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'tinkerfleet-http-native-')));
 const before='export const add = (a,b) => a-b;\n',after='export const add = (a,b) => a+b;\n';
 await mkdir(path.join(root,'src'));await writeFile(path.join(root,'src/math.js'),before);
 await writeFile(path.join(root,'math.test.js'),"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {add} from './src/math.js';\ntest('approved addition works',()=>assert.equal(add(2,3),5));\n");
 const model=new ScriptedModel([[functionCall('edit_file',{path:'src/math.js',content:after},{callId:'local-edit'})],[functionCall('run_command',{executable:'node',args:['--test','math.test.js'],cwd:'.'},{callId:'local-test'})],[assistantMessage('The approved edit and test succeeded.')]]);
 const port=45332,base=`http://127.0.0.1:${port}`,app=createApp({port,mode:'live',sdkModel:model,workspaceToolsEnabled:true,workspaceRoot:root});
 await new Promise<void>(resolve=>app.server.listen(port,'127.0.0.1',resolve));
 try{
 const session=await fetch(base+'/api/session'),{csrf}=await session.json() as {csrf:string};const headers={Cookie:session.headers.get('set-cookie')!.split(';')[0],Origin:base,'X-Tinkerfleet-CSRF':csrf,'Content-Type':'application/json'};
 const post=(url:string,body:unknown)=>fetch(base+url,{method:'POST',headers,body:JSON.stringify(body)});
 const chat=await(await post('/api/conversations',{participants:[customTeam()[2]]})).json() as {id:string};
 const created=await post(`/api/conversations/${chat.id}/runs`,{prompt:'Fix addition and verify the explicit test file'});assert.equal(created.status,201);const {id}=await created.json() as {id:string};
 const run=()=>app.state().runs.find(r=>r.id===id)!;
 const wait=async(predicate:()=>boolean)=>{for(let i=0;i<200&&!predicate();i++)await delay(5);assert.ok(predicate(),JSON.stringify({status:run().status,messages:run().messages}));};
 await wait(()=>run().status==='awaiting_approval');const edit=run().approvals[0];assert.equal(edit.action.kind,'edit');assert.equal(edit.before,before);assert.equal(await readFile(path.join(root,'src/math.js'),'utf8'),before);assert.equal(run().artifacts.length,0);
 const endpoint=`/api/conversations/${chat.id}/runs/${id}/approval`;
 assert.equal((await post(endpoint,{approvalId:edit.id,digest:'changed',approved:true})).status,409);assert.equal(await readFile(path.join(root,'src/math.js'),'utf8'),before);
 const editDecision={approvalId:edit.id,digest:edit.digest,approved:true};assert.equal((await post(endpoint,editDecision)).status,202);
 await wait(()=>run().approvals.length===2&&run().status==='awaiting_approval');assert.equal(await readFile(path.join(root,'src/math.js'),'utf8'),after);assert.equal(run().artifacts.length,1);assert.equal(run().artifacts[0].simulated,false);assert.equal(run().output,'');
 assert.equal((await post(endpoint,editDecision)).status,409);assert.equal(run().artifacts.length,1);
 const command=run().approvals[1];assert.equal(command.action.kind,'command');if(command.action.kind!=='command')throw Error('Expected command');assert.ok(command.action.resolvedExecutable?.path.startsWith('/'));assert.ok(command.action.resolvedExecutable?.identity);assert.equal((await post(endpoint,{approvalId:command.id,digest:command.digest,approved:true})).status,202);
 await wait(()=>run().status==='completed');assert.match(run().output,/approved addition works/);assert.match(run().output,/exit code 0/);assert.equal(run().usage!.modelCalls,3);assert.equal(run().artifacts.length,1);assert.ok(run().approvals.every(a=>a.status==='approved'));
 const {ConversationStore}=await import('../src/server/conversations.js');const saved=new ConversationStore(path.join(root,'history.json'));saved.save(app.state().conversations,app.state().runs);const restoredCommand=new ConversationStore(path.join(root,'history.json')).state.runs[0].approvals[1].action;assert.equal(restoredCommand.kind,'command');if(restoredCommand.kind==='command')assert.deepEqual(restoredCommand.resolvedExecutable,command.action.resolvedExecutable);
 assert.equal((await post(endpoint,{approvalId:command.id,digest:command.digest,approved:true})).status,409);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});

test('coordinator creation persists a reusable bot and immediately uses it in a group without changing old identities',async()=>{
 const {ScriptedModel,assistantMessage,functionCall,modelResponder}=await import('@openai/agents/testing');const {mkdtemp,realpath,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
 const directory=await realpath(await mkdtemp(path.join(tmpdir(),'tinkerfleet-library-'))),statePath=path.join(directory,'state.json'),port=45333,base=`http://127.0.0.1:${port}`;
 const request={name:'Quill',purpose:'Explain evidence patiently and concisely.',role:'scout'};
 let app:ReturnType<typeof createApp>;
 const model=new ScriptedModel([[functionCall('create_agent',request,{callId:'create-quill'})],[functionCall('create_agent',request,{callId:'replay-quill'})],modelResponder(()=>[functionCall('start_group_conversation',{title:'Evidence discussion',brief:'Explain supplied evidence.',botIds:[app.state().profiles.find(p=>p.name==='Quill')!.id]},{callId:'quill-group'})]),[assistantMessage('Discussing supplied evidence.')],[assistantMessage('Quill is ready in your library.')],[assistantMessage('Hello from your saved Quill.')]]);
 app=createApp({port,mode:'live',sdkModel:model,statePath,workspaceToolsEnabled:false});await new Promise<void>(r=>app.server.listen(port,'127.0.0.1',r));
 try{
 const session=await fetch(base+'/api/session'),{csrf}=await session.json() as {csrf:string};const headers={Cookie:session.headers.get('set-cookie')!.split(';')[0],Origin:base,'X-Tinkerfleet-CSRF':csrf,'Content-Type':'application/json'};
 const post=(url:string,body:unknown)=>fetch(base+url,{method:'POST',headers,body:JSON.stringify(body)});
 const primary=await(await post('/api/conversations',{participants:[customTeam()[0]]})).json() as {id:string};assert.equal((await post(`/api/conversations/${primary.id}/runs`,{prompt:'Create a patient researcher and discuss evidence together.'})).status,201);
 for(let i=0;i<200&&(app.state().runs.length<2||app.state().runs.some(r=>r.status==='running'));i++)await delay(5);
 const bot=app.state().profiles.find(p=>p.name==='Quill')!;assert.ok(bot);assert.equal(app.state().profiles.filter(p=>p.name==='Quill').length,1);assert.equal(app.state().runs.filter(r=>r.messages.some(m=>m.createdAgentId===bot.id)).length,1);assert.ok(app.state().runs.every(r=>r.status==='completed'));assert.ok(app.state().conversations.find(c=>c.startedBy)!.participants.some(p=>p.id===bot.id));
 const direct=await(await post('/api/conversations',{participants:[bot]})).json() as {id:string};assert.equal((await post(`/api/conversations/${direct.id}/runs`,{prompt:'Hello'})).status,201);for(let i=0;i<100&&app.state().runs.some(r=>r.status==='running');i++)await delay(3);
 assert.equal((await post(`/api/profiles/${bot.id}`,{name:'Quill revised'})).status,200);assert.equal(app.state().conversations.find(c=>c.id===direct.id)!.participants[0].name,'Quill');
 assert.equal((await post('/api/profiles/import',{profiles:[bot]})).status,200);assert.equal(app.state().profiles.find(p=>p.id===bot.id)!.name,'Quill revised');
 await app.close();app=createApp({port,mode:'demo',statePath,workspaceToolsEnabled:false});assert.equal(app.state().profiles.find(p=>p.id===bot.id)!.name,'Quill revised');assert.equal(app.state().conversations.find(c=>c.id===direct.id)!.participants[0].name,'Quill');assert.ok(app.state().runs.some(r=>r.messages.some(m=>m.createdAgentId===bot.id)));
 }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});

test('first browser import upgrades provisional profiles once and failed bot creation rolls back every public change',async()=>{
 const {ScriptedModel,assistantMessage,functionCall}=await import('@openai/agents/testing');const {ConversationStore}=await import('../src/server/conversations.js');
 const {mkdtemp,realpath,writeFile,readFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
 const directory=await realpath(await mkdtemp(path.join(tmpdir(),'tinkerfleet-library-rollback-'))),statePath=path.join(directory,'state.json');
 const old=customTeam()[0],now=Date.now();await writeFile(statePath,JSON.stringify({version:1,conversations:[{id:'old-chat',title:'Preserved',participants:[old],createdAt:now,updatedAt:now,draft:'',currentRunId:null}],runs:[]}));
 const model=new ScriptedModel([[functionCall('create_agent',{name:'Unsaved bot',purpose:'Help explain evidence.',role:'scout'},{callId:'unsaved'})],[assistantMessage('Creation could not be saved.')]]);
 const port=45334,base=`http://127.0.0.1:${port}`,app=createApp({port,mode:'live',sdkModel:model,statePath,workspaceToolsEnabled:false});await new Promise<void>(r=>app.server.listen(port,'127.0.0.1',r));const originalSave=ConversationStore.prototype.save;let sawAtomic=false;
 try{
 const session=await fetch(base+'/api/session'),{csrf}=await session.json() as {csrf:string};const headers={Cookie:session.headers.get('set-cookie')!.split(';')[0],Origin:base,'X-Tinkerfleet-CSRF':csrf,'Content-Type':'application/json'};
 const post=(url:string,body:unknown)=>fetch(base+url,{method:'POST',headers,body:JSON.stringify(body)});
 const revised={...old,name:'Browser latest',color:'#1266aa'};assert.equal((await post('/api/profiles/import',{profiles:[revised]})).status,200);assert.equal(app.state().profiles[0].name,revised.name);assert.equal(app.state().conversations[0].participants[0].name,old.name);assert.equal((await post(`/api/profiles/${old.id}`,{role:'scout'})).status,400);assert.equal(app.state().profiles[0].role,'coordinator');
 assert.equal((await post('/api/profiles/import',{profiles:[old]})).status,200);assert.equal(app.state().profiles[0].name,revised.name);
 ConversationStore.prototype.save=function(chats,runs,profiles,imported){const created=profiles?.find(p=>p.name==='Unsaved bot');if(created){sawAtomic=chats.some(c=>c.availableBots?.some(p=>p.id===created.id))&&runs.some(r=>r.messages.some(m=>m.createdAgentId===created.id));throw Error('Simulated disk full');}return originalSave.call(this,chats,runs,profiles,imported);};
 assert.equal((await post('/api/conversations/old-chat/runs',{prompt:'Create a researcher'})).status,201);for(let i=0;i<100&&app.state().runs[0].status==='running';i++)await delay(5);
 assert.equal(sawAtomic,true);assert.ok(app.state().profiles.every(p=>p.name!=='Unsaved bot'));assert.ok(app.state().conversations.every(c=>!c.availableBots?.some(p=>p.name==='Unsaved bot')));assert.ok(app.state().runs.every(r=>r.messages.every(m=>!m.createdAgentId)));assert.doesNotMatch(await readFile(statePath,'utf8'),/Unsaved bot/);
 }finally{ConversationStore.prototype.save=originalSave;await app.close();await rm(directory,{recursive:true,force:true});}
});

test('full library refresh retains historical group roster members and rolls back a failed start refresh',async()=>{
 const {ConversationStore}=await import('../src/server/conversations.js');const {mkdtemp,realpath,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
 const directory=await realpath(await mkdtemp(path.join(tmpdir(),'tinkerfleet-roster-cap-'))),statePath=path.join(directory,'state.json'),team=customTeam(),now=Date.now();
 const roster=Array.from({length:32},(_,i)=>({...team[1],id:`old-${i}`})),library=Array.from({length:32},(_,i)=>({...team[1],id:`new-${i}`}));
 const primary={id:'primary',title:'Primary',participants:[team[0]],availableBots:roster,createdAt:now,updatedAt:now,draft:'',currentRunId:'parent-run'};
 const group={id:'historical-group',title:'Old group',participants:[team[0],roster[31]],createdAt:now,updatedAt:now,draft:'',currentRunId:null,startedBy:{conversationId:primary.id,runId:'parent-run',coordinatorId:team[0].id,brief:'Old brief'}};
 const run={id:'parent-run',conversationId:primary.id,team:primary.participants,prompt:'Old prompt',mode:'demo',status:'completed',messages:[{id:'link',author:'coordinator',text:'Old group',conversationId:group.id,at:now}],events:[],approvals:[],artifacts:[],output:'',activeAgent:null,startedAt:now,endedAt:now};
 await writeFile(statePath,JSON.stringify({version:1,libraryImported:true,profiles:library,conversations:[primary,group,{...primary,id:'refresh-chat',availableBots:[],currentRunId:null}],runs:[run]}));
 const port=45335,base=`http://127.0.0.1:${port}`,app=createApp({port,mode:'demo',demoDelayMs:60_000,statePath});await new Promise<void>(r=>app.server.listen(port,'127.0.0.1',r));const original=ConversationStore.prototype.save;
 try{
 const session=await fetch(base+'/api/session'),{csrf}=await session.json() as {csrf:string};const headers={Cookie:session.headers.get('set-cookie')!.split(';')[0],Origin:base,'X-Tinkerfleet-CSRF':csrf,'Content-Type':'application/json'};
 const post=(url:string,body:unknown)=>fetch(base+url,{method:'POST',headers,body:JSON.stringify(body)});
 assert.equal((await post('/api/conversations/primary/runs',{prompt:'Hello'})).status,201);assert.deepEqual(app.state().conversations.find(c=>c.id==='primary')!.availableBots!.map(p=>p.id),roster.map(p=>p.id));assert.equal(app.state().persistenceError,undefined);
 ConversationStore.prototype.save=function(chats,runs,profiles,imported){if(chats.find(c=>c.id==='refresh-chat')?.availableBots?.length)throw Error('Simulated publish failure');return original.call(this,chats,runs,profiles,imported);};
 assert.equal((await post('/api/conversations/refresh-chat/runs',{prompt:'Hello'})).status,503);assert.deepEqual(app.state().conversations.find(c=>c.id==='refresh-chat')!.availableBots,[]);
 }finally{ConversationStore.prototype.save=original;await app.close();await rm(directory,{recursive:true,force:true});}
});

test('live workspace startup publishes readiness before any run without invoking a model',async()=>{
 const {ScriptedModel}=await import('@openai/agents/testing');const {mkdtemp,realpath,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'tinkerfleet-readiness-'))),model=new ScriptedModel([]);
 const ready=createApp({port:45336,mode:'live',sdkModel:model,workspaceToolsEnabled:true,workspaceRoot:root});
 const unavailable=createApp({port:45337,mode:'live',sdkModel:model,workspaceToolsEnabled:true,workspaceRoot:path.join(root,'missing')});
 try{for(let i=0;i<100&&[ready,unavailable].some(app=>app.state().execution.reason==='Local workspace has not been checked yet.');i++)await delay(3);
 assert.equal(ready.state().liveReady,true);assert.equal(ready.state().execution.available,true);assert.equal(unavailable.state().liveReady,false);assert.equal(unavailable.state().execution.available,false);assert.notEqual(unavailable.state().execution.reason,'Local workspace has not been checked yet.');assert.equal(ready.state().runs.length,0);assert.equal(model.calls.length,0);
 }finally{await ready.close();await unavailable.close();await rm(root,{recursive:true,force:true});}
});
