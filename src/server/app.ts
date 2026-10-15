import {runtimeConfig,type RuntimeOptions} from './config.js';
import type {Model} from '@openai/agents';
import {validateParticipants,validateAvailableBots} from './personas.js';
import {ConversationStore,CONVERSATION_LIMITS,conversationHistory,defaultParticipants,selectCoordinatorGroup} from './conversations.js';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {DemoEngine} from './demo.js';
import {createSecurity,HttpError,json,readJson} from './http.js';
import {canonicalJson} from './approval.js';
import {ApprovalStore} from './approval.js';
import {NativeWorkspaceRunner} from './native-runner.js';
import {createSdkAdapter,redactSdkText,type SdkEvent,type SdkStatus,type SdkStartGroupRequest,type SdkStartedGroup} from './sdk.js';
import type {AppState,Run,AgentId,Action,Conversation,Persona} from '../shared/types.js';

export function createApp(options:RuntimeOptions&{sdkModel?:Model;port:number;mode?:'demo'|'live';workspaceRoot?:string;production?:boolean;demoDelayMs?:number;statePath?:string;initialRuns?:Run[];serve?:(req:IncomingMessage,res:ServerResponse)=>void|Promise<void>}){
  const mode=options.mode??(process.env.TINKERFLEET_MODE==='live'?'live':'demo');
  const config=runtimeConfig(options);
  const model=options.sdkModel?'offline-scripted-model':process.env.TINKERFLEET_MODEL?.trim()||null;
  const modelReady=()=>!!options.sdkModel||!!model&&!!process.env.OPENAI_API_KEY;
  const root=path.resolve(options.workspaceRoot??process.env.TINKERFLEET_WORKSPACE??'examples/tiny-project');
  const store=new ConversationStore(options.statePath,options.initialRuns);
  const conversations=new Map(store.state.conversations.map(chat=>[chat.id,chat]));
  const demo=new DemoEngine(options.demoDelayMs,startGroup);
  const liveRuns=new Map<string,Run>();
  for(const run of store.state.runs)(run.mode==='demo'?demo.runs:liveRuns).set(run.id,run);
  const legacyRunIds=new Set<string>();
  const groupRequests=new Map<string,string>();
  const approvals=new ApprovalStore();
  const runner=config.workspaceToolsEnabled?new NativeWorkspaceRunner({workspaceRoot:root,approvals}):undefined;
  function workspaceRunner(){if(!runner)throw new Error('Workspace tools are disabled.');return runner;}
  const beforeCache=new Map<string,string>();
  const starting=new Set<string>();
  let persistenceError:string|undefined;
  let closing=false;
  const security=createSecurity(options.port);
  let currentRunId:string|null=null;
  let execution={available:false,reason:config.workspaceToolsEnabled?'Local workspace has not been checked yet.':'Workspace tools are disabled; chat needs no local execution.'};
  const agentId=(name?:string):AgentId=>{const s=name?.toLowerCase();return s==='scout'||s==='maker'||s==='checker'?s:'coordinator';};
  function onEvent(e:SdkEvent){
    const run=liveRuns.get(e.runId);if(!run)return;const agent=e.agent?agentId(e.agent):run.activeAgent??run.team?.[0]?.role??'coordinator';const displayName=run.team?.find(persona=>persona.role===agent)?.name??e.agent??'Coordinator';
    if(e.type==='usage'){if(e.usage)run.usage={...e.usage};return;}
    if(e.type==='agent_message'){if(e.message)run.messages.push({id:randomUUID(),at:Date.parse(e.at),author:agent,text:redactSdkText(e.message),kind:'result'});touch(run);return;}
    const labels:Record<string,string>={run_started:'Run started',agent_started:`${displayName} started`,agent_finished:`${displayName} returned`,tool_started:e.tool??'Tool started',tool_finished:`${e.tool??'Tool'} finished`,approval_requested:'Your approval is needed',approval_resolved:e.approved?'Action approved':'Action declined',run_completed:'Run complete',run_failed:'Run could not finish',run_cancelled:'Run stopped'};
    run.events.push({id:randomUUID(),at:Date.parse(e.at),agent,kind:e.type.startsWith('approval')?'approval':e.type.startsWith('tool')?'tool':e.type.startsWith('agent')?'delegation':e.type==='run_failed'?'error':'result',title:labels[e.type]??e.type,detail:e.message??e.tool});
    if(e.type==='agent_started')run.activeAgent=agent;
    if(e.type==='approval_requested'&&e.approval){const p=e.approval;run.status='awaiting_approval';run.approvals.push({id:p.approvalId,digest:p.digest,agent,title:p.action.kind==='edit'?`Update ${p.action.path}`:`Run ${p.action.executable}`,description:'Review this exact action. It changes actual local files or runs a local command in the selected folder. Commands run with your user permissions.',action:p.action,status:'pending',before:beforeCache.get(p.approvalId)});}
    if(e.type==='approval_resolved'){const p=run.approvals.find(a=>a.id===e.approvalId);if(p)p.status=e.approved?'approved':'denied';run.status='running';}
    if(e.type==='run_completed'){run.status='completed';run.activeAgent=null;run.endedAt=Date.now();}
    if(e.type==='run_failed'||e.type==='run_cancelled'){run.status=e.type==='run_failed'?'failed':'cancelled';run.activeAgent=null;run.endedAt=Date.now();for(const a of run.approvals)if(a.status==='pending')a.status='denied';if(e.message)run.messages.push({id:randomUUID(),at:Date.now(),author:agent,text:e.message});}
    touch(run);
    if(['run_completed','run_failed','run_cancelled'].includes(e.type))runner?.disposeRun(run.id);
  }
  const sdk=createSdkAdapter({model:options.sdkModel??model??undefined,workspaceToolsEnabled:config.workspaceToolsEnabled,reasoningEffort:config.reasoningEffort??undefined,limits:config.limits,liveEnabled:mode==='live',onEvent,startGroup,harness:{
    snapshot:id=>workspaceRunner().snapshot(id),readFile:(id,p)=>workspaceRunner().readFile(id,p),
    prepare:async(id,action)=>{const record=await workspaceRunner().prepare(id,action);if(action.kind==='edit')beforeCache.set(record.id,redactSdkText(await workspaceRunner().readFile(id,action.path).catch(()=>'')));return record;},
    decide:(id,approvalId,digest,approved)=>approvals.decide(id,approvalId,digest,approved),
    execute:async(id,approvalId,opts)=>{const record=approvals.get(approvalId);const a=record?.action as Action|undefined;const before=a?.kind==='edit'?await workspaceRunner().readFile(id,a.path).catch(()=>''):'';const result=await workspaceRunner().execute(id,approvalId,opts);const run=liveRuns.get(id);if(run){if(a?.kind==='edit'&&result.status==='completed')run.artifacts.push({path:a.path,before,after:redactSdkText(a.content),simulated:false});if(a?.kind==='command')run.output=redactSdkText(`$ ${a.executable} ${a.args.join(' ')}\n${result.stdout}\n${result.stderr}\nStatus: ${result.status} · exit code ${result.exitCode??'none'}\nCleanup confirmed: ${result.cleanupSucceeded}`);}return result;},
    cancel:id=>runner?.cancel(id),
  }});
  function sync(s:SdkStatus){const r=liveRuns.get(s.runId);if(!r)return;r.usage={...s.usage};r.status=s.status==='error'||s.status==='deferred'?'failed':s.status;for(const p of s.pendingApprovals){const a=r.approvals.find(a=>a.id===p.approvalId);if(a&&a.action.kind==='edit')void workspaceRunner().readFile(r.id,a.action.path).then(before=>a.before=redactSdkText(before)).catch(()=>{});}if(s.status==='deferred'&&s.message)r.messages.push({id:randomUUID(),author:r.activeAgent??r.team?.[0]?.role??'coordinator',text:s.message,at:Date.now()});}
  const allRuns=()=>[...demo.runs.values(),...liveRuns.values()];
  const findRun=(id:string)=>demo.runs.get(id)??liveRuns.get(id);
  function touch(run:Run){const chat=run.conversationId?conversations.get(run.conversationId):undefined;if(chat)chat.updatedAt=Date.now();}
  function persist(required=false){for(const run of allRuns()){const chat=run.conversationId?conversations.get(run.conversationId):undefined;if(chat)chat.updatedAt=Math.max(chat.updatedAt,run.startedAt,run.endedAt??0,...run.messages.map(m=>m.at),...run.events.map(e=>e.at));}try{store.save([...conversations.values()],allRuns());persistenceError=undefined;}catch{persistenceError='Conversation history could not be saved. Check local storage before continuing.';if(required)throw new HttpError(503,persistenceError);}}
  function state():AppState {return {workspaceToolsEnabled:config.workspaceToolsEnabled,reasoningEffort:config.reasoningEffort,limits:config.limits,conversations:[...conversations.values()],...(persistenceError?{persistenceError}:{}),mode,model:mode==='live'?model:null,workspace:path.basename(root),workspaceRoot:root,execution,liveReady:mode==='live'&&modelReady()&&(!config.workspaceToolsEnabled||execution.available),runs:allRuns(),currentRunId,maxTurns:config.limits.maxTurns};}
  function validTitle(value:unknown){if(typeof value!=='string'||!value.trim()||value.trim().length>80||/[\u0000-\u001f\u007f]/.test(value))throw new HttpError(400,'Enter a title of 1–80 characters.');return redactSdkText(value.trim());}
  function startRun(value:unknown,chat:Conversation,res?:ServerResponse,legacy=false,promptAuthor:AgentId|'user'='user',beforePublish?:(run:Run)=>void){
    if(typeof value!=='string'||!value.trim()||value.length>8000)throw new HttpError(400,'Enter a task of 1–8,000 characters.');
    if(starting.has(chat.id)||allRuns().some(run=>run.conversationId===chat.id&&['running','awaiting_approval'].includes(run.status)))throw new HttpError(409,'Finish or stop this conversation’s current run first.');
    if(allRuns().length>=CONVERSATION_LIMITS.runs)throw new HttpError(409,'Saved run limit reached. Existing history was preserved.');
    if(!beforePublish)persist(true);starting.add(chat.id);
    try{
      const prompt=redactSdkText(value.trim()),team=validateParticipants(chat.participants),history=conversationHistory(chat.id,allRuns());
      const run:Run=mode==='demo'?demo.start(prompt,team,{availableBots:chat.availableBots,promptAuthor}):{id:randomUUID(),prompt,team,mode,status:'running',startedAt:Date.now(),activeAgent:team.find(p=>p.role==='coordinator')?.role??team[0].role,messages:[{id:randomUUID(),author:promptAuthor,text:prompt,at:Date.now()}],events:[],approvals:[],artifacts:[],output:''};
      run.conversationId=chat.id;if(mode==='live')liveRuns.set(run.id,run);if(legacy)legacyRunIds.add(run.id);
      currentRunId=run.id;chat.currentRunId=run.id;chat.draft='';touch(run);
      try{beforePublish?.(run);persist(true);}catch(e){if(mode==='demo')demo.cancel(run.id);else{run.status='cancelled';run.activeAgent=null;}throw e;}
      if(res)json(res,201,run);if(mode==='demo')return run;
      const id=run.id;
      void(async()=>{
        if(runner){const availability=await runner.checkAvailability();execution={available:availability.available,reason:availability.reason??'Ready'};}
        if(closing||run.status==='cancelled')return;
        if(!modelReady()||(config.workspaceToolsEnabled&&!execution.available)){onEvent({runId:id,type:'run_failed',at:new Date().toISOString(),message:config.workspaceToolsEnabled?'Live workspace mode needs an accessible local folder, an explicit model, and a server-side API key. Nothing has been sent to a model.':'Live chat needs an explicit model and a server-side API key. Nothing has been sent to a model.'});persist();return;}
        if(runner)await runner.snapshot(id);if(closing||(run.status as string)==='cancelled')return;
        sync(await sdk.start({runId:id,prompt,team,history,availableBots:chat.availableBots}));persist();
      })().catch(()=>{if(run.status!=='cancelled')onEvent({runId:id,type:'run_failed',at:new Date().toISOString(),message:'The run failed safely. Review local configuration before starting another run.'});persist();});
      return run;
    }finally{starting.delete(chat.id);}
  }
  async function startGroup(runId:string,request:SdkStartGroupRequest):Promise<SdkStartedGroup>{
    if(closing)throw new Error('The server is shutting down.');
    const sourceRun=findRun(runId),source=sourceRun?.conversationId?conversations.get(sourceRun.conversationId):undefined;
    if(!sourceRun||!source)throw new Error('Source conversation not found.');
    const selected=selectCoordinatorGroup(source,sourceRun,request);
    const requestKey=canonicalJson(selected);
    const existing=[...conversations.values()].find(chat=>chat.startedBy?.runId===runId);
    if(existing){if(groupRequests.get(runId)!==requestKey)throw new Error('This coordinator run already started a different group.');return {conversationId:existing.id,title:existing.title};}
    if(conversations.size>=CONVERSATION_LIMITS.conversations||allRuns().length>=CONVERSATION_LIMITS.runs)throw new Error('Conversation or run limit reached.');
    // All validation and publication below are synchronous: cancellation cannot interleave a creation.
    const now=Date.now(),group:Conversation={id:randomUUID(),title:selected.title,participants:selected.participants,createdAt:now,updatedAt:now,draft:'',currentRunId:null,startedBy:{conversationId:source.id,runId,coordinatorId:source.participants[0].id,brief:selected.brief}};
    const previousCurrent=currentRunId;conversations.set(group.id,group);
    let child:Run|undefined,linkId:string|undefined;
    try{
      child=startRun(selected.brief,group,undefined,false,'coordinator',run=>{
        child=run;linkId=randomUUID();sourceRun.messages.push({id:linkId,author:'coordinator',text:`Started ${group.title} with ${group.participants.slice(1).map(p=>p.name).join(', ')}.`,conversationId:group.id,kind:'delegation',at:Date.now()});touch(sourceRun);
      });
      // The child and source link have been persisted in the same atomic replacement.
      groupRequests.set(runId,requestKey);return {conversationId:group.id,title:group.title};
    }catch(error){
      child??=group.currentRunId?findRun(group.currentRunId):undefined;
      if(child){if(child.mode==='demo'){demo.cancel(child.id);demo.runs.delete(child.id);}else{child.status='cancelled';runner?.disposeRun(child.id);liveRuns.delete(child.id);}}
      if(linkId)sourceRun.messages=sourceRun.messages.filter(message=>message.id!==linkId);
      conversations.delete(group.id);currentRunId=previousCurrent;persist();throw error;
    }
  }
  async function api(req:IncomingMessage,res:ServerResponse,url:URL){
    const method=req.method??'GET';
    if(closing)throw new HttpError(503,'The server is shutting down.');
    if(url.pathname==='/api/session'&&method==='GET'){security.check(req,false);json(res,200,security.bootstrap(res));return;}
    security.check(req);
    if(url.pathname==='/api/state'&&method==='GET'){persist();json(res,200,state());return;}
    if(url.pathname==='/api/conversations'&&method==='POST'){
      const body=await readJson(req);
      if(Object.keys(body).some(key=>!['title','participants','availableBots'].includes(key)))throw new HttpError(400,'Only title, one participant, and an optional coordinator roster are accepted.');
      let participants:Persona[];try{participants=validateParticipants(body.participants);}catch(e){throw new HttpError(400,(e as Error).message);}
      if(participants.length!==1)throw new HttpError(400,'Start a direct conversation. Only a coordinator can bring bots into a group.');
      let availableBots:Persona[]|undefined;
      if(body.availableBots!==undefined){if(participants[0].role!=='coordinator')throw new HttpError(400,'Only a direct coordinator can have an available-bot roster.');try{availableBots=validateAvailableBots(body.availableBots);}catch(e){throw new HttpError(400,(e as Error).message);}if(availableBots.some(bot=>bot.id===participants[0].id))throw new HttpError(400,'Coordinator and specialist IDs must differ.');}
      const title=validTitle(body.title??'New chat');
      if(conversations.size>=CONVERSATION_LIMITS.conversations)throw new HttpError(409,'Conversation limit reached. Existing history was preserved.');
      const now=Date.now(),chat:Conversation={id:randomUUID(),title,participants,...(availableBots?{availableBots}:{}),createdAt:now,updatedAt:now,draft:'',currentRunId:null};
      conversations.set(chat.id,chat);try{persist(true);}catch(e){conversations.delete(chat.id);throw e;}json(res,201,chat);return;
    }
    const conversationRoute=/^\/api\/conversations\/([a-zA-Z0-9_-]+)(?:\/(runs))?$/.exec(url.pathname);
    if(conversationRoute&&method==='POST'){
      const chat=conversations.get(conversationRoute[1]);if(!chat)throw new HttpError(404,'Conversation not found.');
      const body=await readJson(req);
      if(conversationRoute[2]){if(Object.keys(body).some(key=>key!=='prompt'))throw new HttpError(400,'Only a prompt is accepted; participants belong to this conversation.');await startRun(body.prompt,chat,res);return;}
      if(Object.keys(body).some(key=>!['title','draft','availableBots'].includes(key)))throw new HttpError(400,'Only title, draft, and an initial coordinator roster can be updated.');
      const title=body.title===undefined?chat.title:validTitle(body.title);
      if(body.draft!==undefined&&(typeof body.draft!=='string'||body.draft.length>8000))throw new HttpError(400,'Drafts allow up to 8,000 characters.');
      let availableBots=chat.availableBots;
      if(body.availableBots!==undefined){
        if(chat.participants.length!==1||chat.participants[0].role!=='coordinator'||chat.startedBy)throw new HttpError(400,'Only a direct coordinator can have an available-bot roster.');
        if(starting.has(chat.id)||allRuns().some(run=>run.conversationId===chat.id&&['running','awaiting_approval'].includes(run.status)))throw new HttpError(409,'Finish or stop this conversation before initializing its roster.');
        try{availableBots=validateAvailableBots(body.availableBots);}catch(e){throw new HttpError(400,(e as Error).message);}
        if(availableBots.some(bot=>bot.id===chat.participants[0].id))throw new HttpError(400,'Coordinator and specialist IDs must differ.');
        if(chat.availableBots!==undefined&&canonicalJson(chat.availableBots)!==canonicalJson(availableBots))throw new HttpError(409,'This conversation’s roster is already saved. Start a new conversation to choose a different roster.');
      }
      const previous={...chat};chat.title=title;if(typeof body.draft==='string')chat.draft=redactSdkText(body.draft);if(availableBots!==undefined)chat.availableBots=availableBots;chat.updatedAt=Date.now();
      try{persist(true);}catch(e){Object.assign(chat,previous);if(previous.availableBots===undefined)delete chat.availableBots;throw e;}json(res,200,chat);return;
    }
    if(url.pathname==='/api/runs'&&method==='POST'){
      // Compatibility route: a legacy request receives its own chat, never another chat's context.
      const body=await readJson(req);let team:Persona[];try{team=body.team===undefined?defaultParticipants().slice(0,1):validateParticipants(body.team);}catch(e){throw new HttpError(400,(e as Error).message);}if(team.length!==1)throw new HttpError(400,'Only a coordinator can create a group; legacy starts also require one bot.');
      if(starting.has('legacy')||[...legacyRunIds].some(id=>{const run=findRun(id);return run&&['running','awaiting_approval'].includes(run.status);}))throw new HttpError(409,'Finish or stop the current legacy run before starting another.');
      if(conversations.size>=CONVERSATION_LIMITS.conversations)throw new HttpError(409,'Conversation limit reached.');
      const now=Date.now(),chat:Conversation={id:randomUUID(),title:typeof body.prompt==='string'?redactSdkText(body.prompt.trim()).slice(0,80)||'New chat':'New chat',participants:team,createdAt:now,updatedAt:now,draft:'',currentRunId:null};
      starting.add('legacy');conversations.set(chat.id,chat);try{await startRun(body.prompt,chat,res,true);}catch(e){if(!chat.currentRunId)conversations.delete(chat.id);throw e;}finally{starting.delete('legacy');}return;
    }
    const scoped=/^\/api\/conversations\/([a-zA-Z0-9_-]+)\/runs\/([a-zA-Z0-9_-]+)\/(approval|stop)$/.exec(url.pathname);
    const legacy=/^\/api\/runs\/([a-zA-Z0-9_-]+)\/(approval|stop)$/.exec(url.pathname);
    if((scoped||legacy)&&method==='POST'){
      const id=scoped?scoped[2]:legacy![1],operation=scoped?scoped[3]:legacy![2];const run=findRun(id);
      if(!run||(scoped?run.conversationId!==scoped[1]||!conversations.has(scoped[1]):!legacyRunIds.has(id)))throw new HttpError(404,'Run not found in this conversation.');
      const body=await readJson(req);
      if(operation==='stop'){
        if(run.mode==='demo')demo.cancel(id);else {await sdk.cancel(id);runner?.disposeRun(id);if(['running','awaiting_approval'].includes(run.status))onEvent({runId:id,type:'run_cancelled',at:new Date().toISOString(),message:'Stopped. Pending approvals are invalid.'});}
        touch(run);persist(true);json(res,200,{ok:true});return;
      }
      if(run.mode==='live'&&!config.workspaceToolsEnabled)throw new HttpError(409,'Workspace approvals are unavailable in chat-only mode.');
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
  return {server,state,async close(){closing=true;clearInterval(saveTimer);for(const run of liveRuns.values())if(['running','awaiting_approval'].includes(run.status)){run.status='cancelled';run.activeAgent=null;run.endedAt=Date.now();for(const approval of run.approvals)if(approval.status==='pending')approval.status='denied';touch(run);}try{for(const id of demo.runs.keys())demo.cancel(id);await Promise.all([...liveRuns.keys()].map(id=>sdk.cancel(id)));for(const id of liveRuns.keys())runner?.disposeRun(id);const cleanup=runner?await runner.shutdown():{cleanupSucceeded:true};persist(true);return cleanup;}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}}};
}
