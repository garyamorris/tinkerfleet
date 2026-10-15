import {validateTeam,validateParticipants} from './personas.js';
import {ConversationStore,CONVERSATION_LIMITS,conversationHistory,defaultParticipants} from './conversations.js';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomUUID} from 'node:crypto';
import {existsSync,constants} from 'node:fs';
import {readFileSync,openSync,fstatSync,closeSync} from 'node:fs';
import path from 'node:path';
import {DemoEngine} from './demo.js';
import {createSecurity,HttpError,json,readJson} from './http.js';
import {ApprovalStore} from './approval.js';
import {SafeContainerRunner} from './runner.js';
import {createSdkAdapter,redactSdkText,type SdkEvent,type SdkStatus} from './sdk.js';
import type {AppState,Run,AgentId,Action,Conversation,Persona} from '../shared/types.js';

export function createApp(options:{port:number;mode?:'demo'|'live';workspaceRoot?:string;production?:boolean;demoDelayMs?:number;statePath?:string;initialRuns?:Run[];serve?:(req:IncomingMessage,res:ServerResponse)=>void|Promise<void>}){
  const mode=options.mode??(process.env.TINKERFLEET_MODE==='live'?'live':'demo');
  const model=process.env.TINKERFLEET_MODEL?.trim()||null;
  const root=options.workspaceRoot??process.env.TINKERFLEET_WORKSPACE??path.resolve('examples/tiny-project');
  const store=new ConversationStore(options.statePath,options.initialRuns);
  const conversations=new Map(store.state.conversations.map(chat=>[chat.id,chat]));
  const demo=new DemoEngine(options.demoDelayMs);
  const liveRuns=new Map<string,Run>();
  for(const run of store.state.runs)(run.mode==='demo'?demo.runs:liveRuns).set(run.id,run);
  const legacyRunIds=new Set<string>();
  const approvals=new ApprovalStore();
  const snapshotPath=process.env.TINKERFLEET_SNAPSHOT;
  function readManifest(file:string){const fd=openSync(path.resolve(file),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>3*1024*1024)throw new Error('Snapshot manifest must be a regular JSON file under 3 MiB.');return JSON.parse(readFileSync(fd,'utf8'));}finally{closeSync(fd);}}
  const runner=new SafeContainerRunner({...((options.workspaceRoot||process.env.TINKERFLEET_WORKSPACE)?{workspaceRoot:root}:{snapshotManifest:readManifest(snapshotPath??path.resolve('examples/tiny-project.snapshot.json'))}),approvals});
  const beforeCache=new Map<string,string>();
  const starting=new Set<string>();
  let persistenceError:string|undefined;
  let closing=false;
  const security=createSecurity(options.port);
  let currentRunId:string|null=null;
  let docker={available:false,reason:existsSync('/usr/bin/docker')||existsSync('/usr/local/bin/docker')?'Not probed in demo mode':'Docker not installed'};
  const agentId=(name?:string):AgentId=>{const s=name?.toLowerCase();return s==='scout'||s==='maker'||s==='checker'?s:'coordinator';};
  function onEvent(e:SdkEvent){
    const run=liveRuns.get(e.runId);if(!run)return;const agent=e.agent?agentId(e.agent):run.activeAgent??run.team?.[0]?.role??'coordinator';const displayName=run.team?.find(persona=>persona.role===agent)?.name??e.agent??'Coordinator';
    if(e.type==='usage')return;
    if(e.type==='agent_message'){if(e.message)run.messages.push({id:randomUUID(),at:Date.parse(e.at),author:agent,text:redactSdkText(e.message),kind:'result'});touch(run);return;}
    const labels:Record<string,string>={run_started:'Run started',agent_started:`${displayName} started`,agent_finished:`${displayName} returned`,tool_started:e.tool??'Tool started',tool_finished:`${e.tool??'Tool'} finished`,approval_requested:'Your approval is needed',approval_resolved:e.approved?'Action approved':'Action declined',run_completed:'Run complete',run_failed:'Run could not finish',run_cancelled:'Run stopped'};
    run.events.push({id:randomUUID(),at:Date.parse(e.at),agent,kind:e.type.startsWith('approval')?'approval':e.type.startsWith('tool')?'tool':e.type.startsWith('agent')?'delegation':e.type==='run_failed'?'error':'result',title:labels[e.type]??e.type,detail:e.message??e.tool});
    if(e.type==='agent_started')run.activeAgent=agent;
    if(e.type==='approval_requested'&&e.approval){const p=e.approval;run.status='awaiting_approval';run.approvals.push({id:p.approvalId,digest:p.digest,agent,title:p.action.kind==='edit'?`Update ${p.action.path}`:`Run ${p.action.executable}`,description:'Review this exact action. It applies only to the disposable run snapshot.',action:p.action,status:'pending',before:beforeCache.get(p.approvalId)});}
    if(e.type==='approval_resolved'){const p=run.approvals.find(a=>a.id===e.approvalId);if(p)p.status=e.approved?'approved':'denied';run.status='running';}
    if(e.type==='run_completed'){run.status='completed';run.activeAgent=null;run.endedAt=Date.now();}
    if(e.type==='run_failed'||e.type==='run_cancelled'){run.status=e.type==='run_failed'?'failed':'cancelled';run.activeAgent=null;run.endedAt=Date.now();for(const a of run.approvals)if(a.status==='pending')a.status='denied';if(e.message)run.messages.push({id:randomUUID(),at:Date.now(),author:agent,text:e.message});}
    touch(run);
    if(['run_completed','run_failed','run_cancelled'].includes(e.type))runner.disposeRun(run.id);
  }
  const sdk=createSdkAdapter({model:model??undefined,liveEnabled:mode==='live',onEvent,harness:{
    snapshot:id=>runner.snapshot(id),readFile:(id,p)=>runner.readFile(id,p),
    prepare:async(id,action)=>{const record=await runner.prepare(id,action);if(action.kind==='edit')beforeCache.set(record.id,redactSdkText(await runner.readFile(id,action.path).catch(()=>'')));return record;},
    decide:(id,approvalId,digest,approved)=>approvals.decide(id,approvalId,digest,approved),
    execute:async(id,approvalId,opts)=>{const record=approvals.get(approvalId);const a=record?.action as Action|undefined;const before=a?.kind==='edit'?await runner.readFile(id,a.path).catch(()=>''):'';const result=await runner.execute(id,approvalId,opts);const run=liveRuns.get(id);if(run){if(a?.kind==='edit'&&result.status==='completed')run.artifacts.push({path:a.path,before,after:redactSdkText(a.content),simulated:false});if(a?.kind==='command')run.output=redactSdkText(`$ ${a.executable} ${a.args.join(' ')}\n${result.stdout}\n${result.stderr}\nStatus: ${result.status} · exit code ${result.exitCode??'none'}\nCleanup confirmed: ${result.cleanupSucceeded}`);}return result;},
    cancel:id=>runner.cancel(id),
  }});
  function sync(s:SdkStatus){const r=liveRuns.get(s.runId);if(!r)return;r.status=s.status==='error'||s.status==='deferred'?'failed':s.status;for(const p of s.pendingApprovals){const a=r.approvals.find(a=>a.id===p.approvalId);if(a&&a.action.kind==='edit')void runner.readFile(r.id,a.action.path).then(before=>a.before=redactSdkText(before)).catch(()=>{});}if(s.status==='deferred'&&s.message)r.messages.push({id:randomUUID(),author:r.activeAgent??r.team?.[0]?.role??'coordinator',text:s.message,at:Date.now()});}
  const allRuns=()=>[...demo.runs.values(),...liveRuns.values()];
  const findRun=(id:string)=>demo.runs.get(id)??liveRuns.get(id);
  function touch(run:Run){const chat=run.conversationId?conversations.get(run.conversationId):undefined;if(chat)chat.updatedAt=Date.now();}
  function persist(required=false){for(const run of allRuns()){const chat=run.conversationId?conversations.get(run.conversationId):undefined;if(chat)chat.updatedAt=Math.max(chat.updatedAt,run.startedAt,run.endedAt??0,...run.messages.map(m=>m.at),...run.events.map(e=>e.at));}try{store.save([...conversations.values()],allRuns());persistenceError=undefined;}catch{persistenceError='Conversation history could not be saved. Check local storage before continuing.';if(required)throw new HttpError(503,persistenceError);}}
  function state():AppState {return {conversations:[...conversations.values()],...(persistenceError?{persistenceError}:{}),mode,model:mode==='live'?model:null,workspace:path.basename(root),docker,liveReady:mode==='live'&&!!model&&!!process.env.OPENAI_API_KEY&&docker.available,runs:allRuns(),currentRunId,maxTurns:8};}
  function validTitle(value:unknown){if(typeof value!=='string'||!value.trim()||value.trim().length>80||/[\u0000-\u001f\u007f]/.test(value))throw new HttpError(400,'Enter a title of 1–80 characters.');return redactSdkText(value.trim());}
  async function startRun(value:unknown,chat:Conversation,res:ServerResponse,legacy=false){
    if(typeof value!=='string'||!value.trim()||value.length>8000)throw new HttpError(400,'Enter a task of 1–8,000 characters.');
    if(starting.has(chat.id)||allRuns().some(run=>run.conversationId===chat.id&&['running','awaiting_approval'].includes(run.status)))throw new HttpError(409,'Finish or stop this conversation’s current run first.');
    if(allRuns().length>=CONVERSATION_LIMITS.runs)throw new HttpError(409,'Saved run limit reached. Existing history was preserved.');
    persist(true);starting.add(chat.id);
    try{
      const prompt=redactSdkText(value.trim()),team=validateParticipants(chat.participants),history=conversationHistory(chat.id,allRuns());
      const run:Run=mode==='demo'?demo.start(prompt,team):{id:randomUUID(),prompt,team,mode,status:'running',startedAt:Date.now(),activeAgent:team.find(p=>p.role==='coordinator')?.role??team[0].role,messages:[{id:randomUUID(),author:'user',text:prompt,at:Date.now()}],events:[],approvals:[],artifacts:[],output:''};
      run.conversationId=chat.id;if(mode==='live')liveRuns.set(run.id,run);if(legacy)legacyRunIds.add(run.id);
      currentRunId=run.id;chat.currentRunId=run.id;chat.draft='';touch(run);
      try{persist(true);}catch(e){if(mode==='demo')demo.cancel(run.id);else{run.status='cancelled';run.activeAgent=null;}throw e;}
      json(res,201,run);if(mode==='demo')return;
      const id=run.id;
      void(async()=>{
        const availability=await runner.checkAvailability();docker={available:availability.available,reason:availability.reason??'Ready'};
        if(run.status==='cancelled')return;
        if(!docker.available||!model||!process.env.OPENAI_API_KEY){onEvent({runId:id,type:'run_failed',at:new Date().toISOString(),message:'Live mode needs local Docker with the prepared image, an explicit model, and a server-side API key. Nothing has been sent to a model.'});persist();return;}
        await runner.snapshot(id);if((run.status as string)==='cancelled')return;
        sync(await sdk.start({runId:id,prompt,team,history}));persist();
      })().catch(()=>{if(run.status!=='cancelled')onEvent({runId:id,type:'run_failed',at:new Date().toISOString(),message:'The run failed safely. Review local configuration before starting another run.'});persist();});
    }finally{starting.delete(chat.id);}
  }
  async function api(req:IncomingMessage,res:ServerResponse,url:URL){
    const method=req.method??'GET';
    if(closing)throw new HttpError(503,'The server is shutting down.');
    if(url.pathname==='/api/session'&&method==='GET'){security.check(req,false);json(res,200,security.bootstrap(res));return;}
    security.check(req);
    if(url.pathname==='/api/state'&&method==='GET'){persist();json(res,200,state());return;}
    if(url.pathname==='/api/conversations'&&method==='POST'){
      const body=await readJson(req);
      if(Object.keys(body).some(key=>!['title','participants'].includes(key)))throw new HttpError(400,'Only title and participants are accepted.');
      let participants:Persona[];try{participants=validateParticipants(body.participants);}catch(e){throw new HttpError(400,(e as Error).message);}
      const title=validTitle(body.title??'New chat');
      if(conversations.size>=CONVERSATION_LIMITS.conversations)throw new HttpError(409,'Conversation limit reached. Existing history was preserved.');
      const now=Date.now(),chat:Conversation={id:randomUUID(),title,participants,createdAt:now,updatedAt:now,draft:'',currentRunId:null};
      conversations.set(chat.id,chat);try{persist(true);}catch(e){conversations.delete(chat.id);throw e;}json(res,201,chat);return;
    }
    const conversationRoute=/^\/api\/conversations\/([a-zA-Z0-9_-]+)(?:\/(runs))?$/.exec(url.pathname);
    if(conversationRoute&&method==='POST'){
      const chat=conversations.get(conversationRoute[1]);if(!chat)throw new HttpError(404,'Conversation not found.');
      const body=await readJson(req);
      if(conversationRoute[2]){if(Object.keys(body).some(key=>key!=='prompt'))throw new HttpError(400,'Only a prompt is accepted; participants belong to this conversation.');await startRun(body.prompt,chat,res);return;}
      if(Object.keys(body).some(key=>!['title','draft'].includes(key)))throw new HttpError(400,'Only title and draft can be updated.');
      const title=body.title===undefined?chat.title:validTitle(body.title);
      if(body.draft!==undefined&&(typeof body.draft!=='string'||body.draft.length>8000))throw new HttpError(400,'Drafts allow up to 8,000 characters.');
      const previous={...chat};chat.title=title;if(typeof body.draft==='string')chat.draft=redactSdkText(body.draft);chat.updatedAt=Date.now();
      try{persist(true);}catch(e){Object.assign(chat,previous);throw e;}json(res,200,chat);return;
    }
    if(url.pathname==='/api/runs'&&method==='POST'){
      // Compatibility route: a legacy request receives its own chat, never another chat's context.
      const body=await readJson(req);let team:Persona[]|undefined;try{team=validateTeam(body.team);}catch(e){throw new HttpError(400,(e as Error).message);}
      if(starting.has('legacy')||[...legacyRunIds].some(id=>{const run=findRun(id);return run&&['running','awaiting_approval'].includes(run.status);}))throw new HttpError(409,'Finish or stop the current legacy run before starting another.');
      if(conversations.size>=CONVERSATION_LIMITS.conversations)throw new HttpError(409,'Conversation limit reached.');
      const now=Date.now(),chat:Conversation={id:randomUUID(),title:typeof body.prompt==='string'?redactSdkText(body.prompt.trim()).slice(0,80)||'New chat':'New chat',participants:team??defaultParticipants(),createdAt:now,updatedAt:now,draft:'',currentRunId:null};
      starting.add('legacy');conversations.set(chat.id,chat);try{await startRun(body.prompt,chat,res,true);}catch(e){if(!chat.currentRunId)conversations.delete(chat.id);throw e;}finally{starting.delete('legacy');}return;
    }
    const scoped=/^\/api\/conversations\/([a-zA-Z0-9_-]+)\/runs\/([a-zA-Z0-9_-]+)\/(approval|stop)$/.exec(url.pathname);
    const legacy=/^\/api\/runs\/([a-zA-Z0-9_-]+)\/(approval|stop)$/.exec(url.pathname);
    if((scoped||legacy)&&method==='POST'){
      const id=scoped?scoped[2]:legacy![1],operation=scoped?scoped[3]:legacy![2];const run=findRun(id);
      if(!run||(scoped?run.conversationId!==scoped[1]||!conversations.has(scoped[1]):!legacyRunIds.has(id)))throw new HttpError(404,'Run not found in this conversation.');
      const body=await readJson(req);
      if(operation==='stop'){
        if(run.mode==='demo')demo.cancel(id);else {await sdk.cancel(id);runner.disposeRun(id);if(['running','awaiting_approval'].includes(run.status))onEvent({runId:id,type:'run_cancelled',at:new Date().toISOString(),message:'Stopped. Pending approvals are invalid.'});}
        touch(run);persist(true);json(res,200,{ok:true});return;
      }
      const {approvalId,digest,approved}=body;if(typeof approvalId!=='string'||typeof digest!=='string'||typeof approved!=='boolean')throw new HttpError(400,'An exact approval ID, digest, and explicit decision are required.');
      if(run.mode==='demo'){try{demo.decide(id,approvalId,digest,approved);}catch(e){throw new HttpError(409,(e as Error).message);}touch(run);persist(true);json(res,200,{ok:true});return;}
      const pending=run.approvals.find(a=>a.id===approvalId&&a.status==='pending');if(!pending||pending.digest!==digest||run.status!=='awaiting_approval')throw new HttpError(409,'This approval is stale, changed, or already used.');
      pending.status=approved?'approved':'denied';run.status='running';touch(run);persist(true);json(res,202,{ok:true});
      void sdk.resume({runId:id,approvalId,digest,approved}).then(s=>{sync(s);persist();}).catch(()=>{onEvent({runId:id,type:'run_failed',at:new Date().toISOString(),message:'That approval could not be resumed. Start a new run; the old approval cannot be reused.'});persist();});return;
    }
    throw new HttpError(404,'Endpoint not found.');
  }
  const server=createServer(async(req,res)=>{security.headers(res,!!options.production);try{const url=new URL(req.url??'/',`http://127.0.0.1:${options.port}`);security.check(req,false,url.pathname==='/');if(url.pathname.startsWith('/api/'))await api(req,res,url);else if(options.serve)await options.serve(req,res);else throw new HttpError(404,'Asset not found.');}catch(e){if(res.headersSent){res.end();return;}json(res,e instanceof HttpError?e.status:400,{error:e instanceof HttpError?e.message:'The request could not be completed safely.'});}});
  server.requestTimeout=15_000;server.headersTimeout=10_000;server.keepAliveTimeout=5_000;
  persist(true);const saveTimer=setInterval(()=>persist(),250);saveTimer.unref();
  return {server,state,async close(){closing=true;clearInterval(saveTimer);try{for(const id of demo.runs.keys())demo.cancel(id);await Promise.all([...liveRuns.keys()].map(id=>sdk.cancel(id)));for(const id of liveRuns.keys())runner.disposeRun(id);const cleanup=await runner.shutdown();persist(true);return cleanup;}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}}};
}
