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
 const results=await Promise.all([1,2].map(()=>fetch(origin+'/api/runs',{method:'POST',headers:auth,body:'{"prompt":"Fix the tiny project"}'})));assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
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
