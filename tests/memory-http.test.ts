import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server/app.js';
import type {AppState, MemoryEntry, Persona} from '../src/shared/types.js';
import {customTeam} from './personas.fixture.js';

const networkFetch = globalThis.fetch;
let externalRequests = 0;
before(() => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.hostname !== '127.0.0.1' || !['45490','45491','45492','45493'].includes(url.port)) {
      externalRequests++;
      throw new Error('External network is forbidden in memory HTTP tests.');
    }
    return networkFetch(input, init);
  };
});
after(() => { globalThis.fetch = networkFetch; assert.equal(externalRequests, 0); });

async function fixture(t: test.TestContext, port: number) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tinkerfleet-memory-http-'));
  const statePath = path.join(directory, 'conversations.json');
  const base = `http://127.0.0.1:${port}`;
  const create = () => createApp({port, mode:'demo', statePath, workspaceToolsEnabled:false, webSearchEnabled:false});
  let app = create(), headers: Record<string,string> = {};
  const listen = () => new Promise<void>((resolve, reject) => { app.server.once('error', reject); app.server.listen(port,'127.0.0.1',resolve); });
  const send = (route:string, method='GET', body?:unknown, auth:Record<string,string>=headers) => fetch(base+route, {
    method, headers:{...auth,Connection:'close'}, ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  const authenticate = async () => {
    const response = await send('/api/session','GET',undefined,{});
    assert.equal(response.status,200);
    const {csrf} = await response.json() as {csrf:string};
    headers = {Cookie:response.headers.get('set-cookie')!.split(';')[0],Origin:base,'X-Tinkerfleet-CSRF':csrf,'Content-Type':'application/json'};
  };
  t.after(async () => { if(app.server.listening)await app.close(); await rm(directory,{recursive:true,force:true}); });
  await listen(); await authenticate();
  return {
    get app(){return app;}, get headers(){return {...headers};}, base, statePath, send,
    async restart(){await app.close();app=create();await listen();await authenticate();},
    async direct(bot:Persona){const response=await send('/api/conversations','POST',{title:`Memory for ${bot.name}`,participants:[bot]});assert.equal(response.status,201);return response.json() as Promise<{id:string}>;},
    async remember(agentId:string,text:string){const response=await send('/api/memories','POST',{agentId,text});assert.equal(response.status,201);return response.json() as Promise<MemoryEntry>;},
    async list(agentId:string){const response=await send(`/api/memories?agentId=${encodeURIComponent(agentId)}`);assert.equal(response.status,200);return response.json() as Promise<MemoryEntry[]>;},
    async state(){const response=await send('/api/state');assert.equal(response.status,200);return response.json() as Promise<AppState>;},
  };
}

test('memory HTTP create/list/delete is scoped to a known direct-chat bot and exposed in state',async t=>{
  const f=await fixture(t,45490),[first,second]=customTeam();
  await f.direct(first!);await f.direct(second!);
  assert.deepEqual(await f.list(first!.id),[]);
  const a=await f.remember(first!.id,'The user prefers concise explanations.');
  const b=await f.remember(second!.id,'Check edge cases before proposing a change.');
  assert.equal(a.agentId,first!.id);assert.equal(a.text,'The user prefers concise explanations.');
  assert.ok(a.id);assert.ok(Number.isFinite(a.createdAt));assert.ok(Number.isFinite(a.updatedAt));
  assert.notEqual(a.id,b.id);
  assert.deepEqual(await f.list(first!.id),[a]);assert.deepEqual(await f.list(second!.id),[b]);
  const state=await f.state();assert.deepEqual(new Set(state.memories.map(entry=>entry.id)),new Set([a.id,b.id]));
  assert.equal(state.runs.length,0);assert.equal(state.mode,'demo');
  assert.equal((await f.send(`/api/memories/${a.id}`,'DELETE',{agentId:second!.id})).status,404);
  assert.deepEqual(await f.list(first!.id),[a]);
  const removed=await f.send(`/api/memories/${a.id}`,'DELETE',{agentId:first!.id});
  assert.equal(removed.status,200);assert.deepEqual(await removed.json(),{ok:true});
  assert.deepEqual(await f.list(first!.id),[]);assert.deepEqual(await f.list(second!.id),[b]);
  assert.equal((await f.send(`/api/memories/${a.id}`,'DELETE',{agentId:first!.id})).status,404);
});

test('memories survive app restart independently per bot; forgetting remains persisted',async t=>{
  const f=await fixture(t,45491),[first,second]=customTeam();
  await f.direct(first!);await f.direct(second!);
  const text='Prefer examples when explaining technical ideas.';
  const a=await f.remember(first!.id,text),b=await f.remember(second!.id,text);
  const oldSession=f.headers;
  await f.restart();
  assert.equal((await f.send('/api/state','GET',undefined,oldSession)).status,401);
  assert.deepEqual(await f.list(first!.id),[a]);assert.deepEqual(await f.list(second!.id),[b]);
  assert.equal((await f.state()).memories.length,2);
  assert.equal((await f.send(`/api/memories/${a.id}`,'DELETE',{agentId:second!.id})).status,404);
  assert.equal((await f.send(`/api/memories/${a.id}`,'DELETE',{agentId:first!.id})).status,200);
  await f.restart();
  assert.deepEqual(await f.list(first!.id),[]);assert.deepEqual(await f.list(second!.id),[b]);
  assert.deepEqual((await f.state()).memories,[b]);assert.equal(f.app.state().runs.length,0);
});

test('memory HTTP reads require a session and writes/deletes require same-origin CSRF',async t=>{
  const f=await fixture(t,45492),bot=customTeam()[0]!;
  await f.direct(bot);
  const route=`/api/memories?agentId=${bot.id}`;
  assert.equal((await f.send(route,'GET',undefined,{})).status,401);
  assert.equal((await f.send('/api/memories','POST',{agentId:bot.id,text:'not saved'}, {'Content-Type':'application/json'})).status,401);
  const noCsrf={Cookie:f.headers.Cookie!,'Content-Type':'application/json'};
  assert.equal((await f.send('/api/memories','POST',{agentId:bot.id,text:'not saved'},noCsrf)).status,403);
  assert.equal((await f.send('/api/memories','POST',{agentId:bot.id,text:'not saved'},{...f.headers,'X-Tinkerfleet-CSRF':'forged'})).status,403);
  assert.equal((await f.send(route,'GET',undefined,{...f.headers,Origin:'https://unrelated.example'})).status,403);
  assert.deepEqual(await f.list(bot.id),[]);
  const memory=await f.remember(bot.id,'Keep this until an authorized delete.');
  assert.equal((await f.send(`/api/memories/${memory.id}`,'DELETE',{agentId:bot.id},noCsrf)).status,403);
  assert.equal((await f.send(`/api/memories/${memory.id}`,'DELETE',{agentId:bot.id},{...f.headers,Origin:'https://unrelated.example'})).status,403);
  assert.deepEqual(await f.list(bot.id),[memory]);
});

test('unknown bot IDs and malformed memory actions are rejected without mutations',async t=>{
  const f=await fixture(t,45493),bot=customTeam()[1]!;
  // A registered profile is also a valid owner before it has a direct conversation.
  assert.equal((await f.send('/api/profiles/import','POST',{profiles:[bot]})).status,200);
  assert.equal((await f.send('/api/memories?agentId=unknown-bot')).status,404);
  assert.equal((await f.send('/api/memories','POST',{agentId:'unknown-bot',text:'not saved'})).status,404);
  assert.equal((await f.send('/api/memories/not-an-entry','DELETE',{agentId:'unknown-bot'})).status,404);
  assert.equal((await f.send('/api/memories')).status,404);
  for(const body of [{agentId:bot.id},{agentId:bot.id,text:12},{agentId:bot.id,text:''},{agentId:bot.id,text:'valid',id:'forged-entry'}]){
    assert.equal((await f.send('/api/memories','POST',body)).status,400);
  }
  assert.deepEqual(await f.list(bot.id),[]);
  const memory=await f.remember(bot.id,'A memory for a registered profile.');
  assert.deepEqual(await f.list(bot.id),[memory]);
  assert.deepEqual((await f.state()).memories,[memory]);
  assert.equal(f.app.state().runs.length,0);
});
