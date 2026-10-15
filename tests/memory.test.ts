import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,statSync,rmSync,symlinkSync,linkSync,mkdirSync,renameSync,readdirSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MemoryStore,MemoryError,MEMORY_LIMITS} from '../src/server/memory.js';

function fixture(t:{after:(fn:()=>void)=>void}){
 const directory=realpathSync(mkdtempSync(path.join(tmpdir(),'tinkerfleet-memory-')));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));return {directory,file:path.join(directory,'memory.json')};
}
const entry=(id='memory-a',agentId='ada',text='Use clear examples.')=>({id,agentId,text,createdAt:1,updatedAt:1});
const envelope=(entries:unknown[])=>JSON.stringify({version:1,entries});

test('memories are per-agent, normalized exact duplicates are stable, and returned values are detached',()=>{
 const store=new MemoryStore(),first=store.remember('ada','  Use examples.\r\nKeep them short.  ');
 assert.equal(first.text,'Use examples.\nKeep them short.');assert.deepEqual(store.remember('ada','Use examples.\nKeep them short.'),first);
 const other=store.remember('bea',first.text);assert.notEqual(first.id,other.id);assert.equal(store.list().length,2);
 first.text='Mutated';const listed=store.list('ada');listed[0].agentId='bea';listed.length=0;
 assert.equal(store.list('ada')[0].text,'Use examples.\nKeep them short.');assert.equal(store.list('ada')[0].agentId,'ada');
 assert.notEqual(store.remember('ada','Use Examples.\nKeep them short.').id,first.id);
 assert.equal(store.list('unknown').length,0);
});

test('private memory persists independently and forget only removes an owned entry across restart',t=>{
 const {directory,file}=fixture(t),history=path.join(directory,'conversations.json');writeFileSync(history,'conversation fixture');
 const store=new MemoryStore(file),ada=store.remember('ada','Use metric units.'),bea=store.remember('bea','Prefer short answers.');
 assert.equal(statSync(file).mode&0o777,0o600);assert.deepEqual(new MemoryStore(file).list(),store.list());
 const before=readFileSync(file,'utf8');assert.equal(store.forget('bea',ada.id),false);assert.equal(store.forget('ada','missing'),false);assert.equal(readFileSync(file,'utf8'),before);
 assert.equal(store.forget('ada',ada.id),true);assert.equal(store.forget('ada',ada.id),false);assert.deepEqual(new MemoryStore(file).list(),[bea]);
 assert.equal(readFileSync(history,'utf8'),'conversation fixture');assert.ok(readdirSync(directory).every(name=>!name.startsWith('.memory-')));
});

test('invalid IDs, oversized text, control characters and secrets never enter memory',()=>{
 const store=new MemoryStore();store.remember('ada','Existing memory.');const before=store.list();
 for(const agentId of ['', '../other','x'.repeat(65),'agent name']){
  assert.throws(()=>store.remember(agentId,'Safe'),MemoryError);assert.throws(()=>store.list(agentId),MemoryError);assert.throws(()=>store.forget(agentId,'id'),MemoryError);
 }
 for(const text of ['', '   ', 'x'.repeat(2001),'bad\0text','bad\u0001text','bad\ud800', 'sk-'+ 'SyntheticOnly12345678901234567890','AKIA'+'A'.repeat(16),'password="synthetic-password-value"','-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----']){
  assert.throws(()=>store.remember('ada',text),(error:unknown)=>error instanceof MemoryError&&(!text||!error.message.includes(text)));
 }
 assert.throws(()=>store.remember('ada',null as unknown as string),MemoryError);assert.throws(()=>store.forget('ada','../id'),MemoryError);
 assert.deepEqual(store.list(),before);
});

test('per-agent entry and character caps reject without mutation while duplicates still succeed at capacity',()=>{
 const store=new MemoryStore();for(let i=0;i<MEMORY_LIMITS.entriesPerAgent;i++)store.remember('ada',`Preference ${i}.`);
 const before=store.list();assert.throws(()=>store.remember('ada','One too many.'),(e:unknown)=>e instanceof MemoryError&&e.code==='CAPACITY');assert.deepEqual(store.list(),before);
 assert.deepEqual(store.remember('ada',' Preference 0. '),before[0]);store.remember('bea','Another agent has room.');
 const full=new MemoryStore();for(let i=0;i<4;i++)full.remember('ada',String(i)+'x'.repeat(1999));
 assert.equal(full.list('ada').reduce((sum,e)=>sum+e.text.length,0),8000);assert.throws(()=>full.remember('ada','x'),/8,000/);assert.equal(full.list().length,4);
 assert.equal(full.forget('ada',full.list()[0].id),true);full.remember('ada','A replacement fits.');
});

test('global historic agent cap is bounded and freed by forgetting the last memory',()=>{
 const store=new MemoryStore();for(let i=0;i<MEMORY_LIMITS.agents;i++)store.remember(`agent-${i}`,'A small preference.');
 const before=store.list();assert.throws(()=>store.remember('one-more','No room.'),/store is full/);assert.deepEqual(store.list(),before);
 store.remember('agent-0','An existing agent still has room.');store.forget('agent-1',store.list('agent-1')[0].id);store.remember('one-more','Room after forgetting.');
 assert.equal(new Set(store.list().map(e=>e.agentId)).size,100);
});

test('all 2,000 permitted entries restore, while exceeding the global envelope is refused intact',t=>{
 const {file}=fixture(t);const entries=Array.from({length:100},(_,agent)=>Array.from({length:20},(_,i)=>entry(`entry-${agent}-${i}`,`agent-${agent}`,`Preference ${i}`))).flat();
 writeFileSync(file,envelope(entries));const store=new MemoryStore(file);assert.equal(store.list().length,2000);
 assert.throws(()=>store.remember('agent-100','Too many.'),/store is full/);assert.equal(new MemoryStore(file).list().length,2000);
 const oversized=envelope([...entries,entry('extra','agent-100')]);writeFileSync(file,oversized);assert.throws(()=>new MemoryStore(file),/left unchanged/);assert.equal(readFileSync(file,'utf8'),oversized);
});

test('corrupt, duplicate, noncanonical, foreign-field and secret-bearing saved schemas fail unchanged',t=>{
 const {file}=fixture(t);const invalid=[
  '{broken',JSON.stringify({version:2,entries:[]}),JSON.stringify({version:1,entries:[],apiKey:'must not accept'}),envelope([{...entry(),extra:'not public'}]),
  envelope([{...entry(),agentId:'../other'}]),envelope([{...entry(),createdAt:-1}]),envelope([{...entry(),updatedAt:0}]),envelope([{...entry(),updatedAt:Infinity}]),
  envelope([entry(),entry()]),envelope([entry(),entry('different-id')]),envelope([entry('a','ada',' padded ')]),envelope([entry('a','ada','x'.repeat(2001))]),
  envelope([entry('a','ada','sk-'+ 'SyntheticOnly12345678901234567890')]),' '.repeat(MEMORY_LIMITS.bytes+1),
 ];
 for(const value of invalid){writeFileSync(file,value);assert.throws(()=>new MemoryStore(file),(e:unknown)=>e instanceof MemoryError&&e.code==='READ_FAILED'&&e.message.includes('left unchanged'));assert.equal(readFileSync(file,'utf8'),value);}
});

test('symlink, dangling symlink, hardlink and directory targets are refused on read and write',t=>{
 const {directory,file}=fixture(t),target=path.join(directory,'target.json');writeFileSync(target,envelope([entry()]));
 const store=new MemoryStore(file);const original=readFileSync(target,'utf8');
 for(const kind of ['symlink','dangling','hardlink','directory']){
  if(kind==='symlink')symlinkSync(target,file);else if(kind==='dangling')symlinkSync(path.join(directory,'missing.json'),file);else if(kind==='hardlink')linkSync(target,file);else mkdirSync(file);
  assert.throws(()=>new MemoryStore(file),/left unchanged/);assert.throws(()=>store.remember('bea','A new preference.'),/left unchanged/);assert.deepEqual(store.list(),[]);assert.equal(readFileSync(target,'utf8'),original);rmSync(file,{recursive:true,force:true});
 }
});

test('symbolic parent directories are refused and missing real directories are created privately',t=>{
 const {directory}=fixture(t),real=path.join(directory,'real'),alias=path.join(directory,'alias');mkdirSync(real);symlinkSync(real,alias);
 assert.throws(()=>new MemoryStore(path.join(alias,'memory.json')),/left unchanged/);
 const nested=path.join(directory,'new','memory.json'),store=new MemoryStore(nested);store.remember('ada','Remember this.');assert.equal(statSync(path.dirname(nested)).mode&0o777,0o700);assert.equal(statSync(nested).mode&0o777,0o600);
});

test('failed remember and forget persistence preserve in-memory state and prior disk contents',t=>{
 const {directory,file}=fixture(t),store=new MemoryStore(file),saved=store.remember('ada','Keep this until explicitly forgotten.'),backup=path.join(directory,'original.json');
 const before=readFileSync(file,'utf8');renameSync(file,backup);mkdirSync(file);
 assert.throws(()=>store.remember('ada','Cannot publish this.'),(e:unknown)=>e instanceof MemoryError&&e.code==='WRITE_FAILED');
 assert.throws(()=>store.forget('ada',saved.id),(e:unknown)=>e instanceof MemoryError&&e.code==='WRITE_FAILED');
 assert.deepEqual(store.list(),[saved]);assert.equal(readFileSync(backup,'utf8'),before);assert.ok(readdirSync(directory).every(name=>!name.startsWith('.memory-')));
 rmSync(file,{recursive:true});renameSync(backup,file);assert.equal(store.forget('ada',saved.id),true);assert.deepEqual(new MemoryStore(file).list(),[]);
});
