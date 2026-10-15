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
import type {AppState,Run,AgentId,Approval,Action} from '../shared/types.js';

export function createApp(options:{port:number;mode?:'demo'|'live';workspaceRoot?:string;production?:boolean;demoDelayMs?:number;serve?:(req:IncomingMessage,res:ServerResponse)=>void|Promise<void>}){
  const mode=options.mode??(process.env.TINKERFLEET_MODE==='live'?'live':'demo');
  const model=process.env.TINKERFLEET_MODEL?.trim()||null;
  const root=options.workspaceRoot??process.env.TINKERFLEET_WORKSPACE??path.resolve('examples/tiny-project');
  const demo=new DemoEngine(options.demoDelayMs);
  const liveRuns=new Map<string,Run>();
  const approvals=new ApprovalStore();
  const snapshotPath=process.env.TINKERFLEET_SNAPSHOT;
  function readManifest(file:string){const fd=openSync(path.resolve(file),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>3*1024*1024)throw new Error('Snapshot manifest must be a regular JSON file under 3 MiB.');return JSON.parse(readFileSync(fd,'utf8'));}finally{closeSync(fd);}}
  const runner=new SafeContainerRunner({...((options.workspaceRoot||process.env.TINKERFLEET_WORKSPACE)?{workspaceRoot:root}:{snapshotManifest:readManifest(snapshotPath??path.resolve('examples/tiny-project.snapshot.json'))}),approvals});
  const beforeCache=new Map<string,string>();
  let starting=false;
  let closing=false;
  const security=createSecurity(options.port);
  let currentRunId:string|null=null;
  let docker={available:false,reason:existsSync('/usr/bin/docker')||existsSync('/usr/local/bin/docker')?'Not probed in demo mode':'Docker not installed'};
  const agentId=(name?:string):AgentId=>{const s=name?.toLowerCase();return s==='scout'||s==='maker'||s==='checker'?s:'coordinator';};
  function onEvent(e:SdkEvent){
    const run=liveRuns.get(e.runId);if(!run)return;const agent=agentId(e.agent);
    if(e.type==='usage')return;
    const labels:Record<string,string>={run_started:'Run started',agent_started:`${e.agent??'Coordinator'} started`,agent_finished:`${e.agent??'Coordinator'} returned`,tool_started:e.tool??'Tool started',tool_finished:`${e.tool??'Tool'} finished`,approval_requested:'Your approval is needed',approval_resolved:e.approved?'Action approved':'Action declined',run_completed:'Run complete',run_failed:'Run could not finish',run_cancelled:'Run stopped'};
    run.events.push({id:randomUUID(),at:Date.parse(e.at),agent,kind:e.type.startsWith('approval')?'approval':e.type.startsWith('tool')?'tool':e.type.startsWith('agent')?'delegation':e.type==='run_failed'?'error':'result',title:labels[e.type]??e.type,detail:e.message??e.tool});
    if(e.type==='agent_started')run.activeAgent=agent;
    if(e.type==='approval_requested'&&e.approval){const p=e.approval;run.status='awaiting_approval';run.approvals.push({id:p.approvalId,digest:p.digest,agent,title:p.action.kind==='edit'?`Update ${p.action.path}`:`Run ${p.action.executable}`,description:'Review this exact action. It applies only to the disposable run snapshot.',action:p.action,status:'pending',before:beforeCache.get(p.approvalId)});}
    if(e.type==='approval_resolved'){const p=run.approvals.find(a=>a.id===e.approvalId);if(p)p.status=e.approved?'approved':'denied';run.status='running';}
    if(e.type==='run_completed'){run.status='completed';run.activeAgent=null;run.endedAt=Date.now();if(e.message)run.messages.push({id:randomUUID(),at:Date.now(),author:'coordinator',text:e.message,kind:'result'});}
    if(e.type==='run_failed'||e.type==='run_cancelled'){run.status=e.type==='run_failed'?'failed':'cancelled';run.activeAgent=null;run.endedAt=Date.now();for(const a of run.approvals)if(a.status==='pending')a.status='denied';if(e.message)run.messages.push({id:randomUUID(),at:Date.now(),author:'coordinator',text:e.message});}
  }
  const sdk=createSdkAdapter({model:model??undefined,liveEnabled:mode==='live',onEvent,harness:{
    snapshot:id=>runner.snapshot(id),readFile:(id,p)=>runner.readFile(id,p),
    prepare:async(id,action)=>{const record=await runner.prepare(id,action);if(action.kind==='edit')beforeCache.set(record.id,redactSdkText(await runner.readFile(id,action.path).catch(()=>'')));return record;},
    decide:(id,approvalId,digest,approved)=>approvals.decide(id,approvalId,digest,approved),
    execute:async(id,approvalId,opts)=>{const record=approvals.get(approvalId);const a=record?.action as Action|undefined;const before=a?.kind==='edit'?await runner.readFile(id,a.path).catch(()=>''):'';const result=await runner.execute(id,approvalId,opts);const run=liveRuns.get(id);if(run){if(a?.kind==='edit'&&result.status==='completed')run.artifacts.push({path:a.path,before,after:redactSdkText(a.content),simulated:false});if(a?.kind==='command')run.output=redactSdkText(`$ ${a.executable} ${a.args.join(' ')}\n${result.stdout}\n${result.stderr}\nStatus: ${result.status} · exit code ${result.exitCode??'none'}\nCleanup confirmed: ${result.cleanupSucceeded}`);}return result;},
    cancel:id=>runner.cancel(id),
  }});
  function sync(s:SdkStatus){const r=liveRuns.get(s.runId);if(!r)return;r.status=s.status==='error'||s.status==='deferred'?'failed':s.status;for(const p of s.pendingApprovals){const a=r.approvals.find(a=>a.id===p.approvalId);if(a&&a.action.kind==='edit')void runner.readFile(r.id,a.action.path).then(before=>a.before=redactSdkText(before)).catch(()=>{});}if(s.status==='deferred'&&s.message)r.messages.push({id:randomUUID(),author:'coordinator',text:s.message,at:Date.now()});}
  function state():AppState {return {mode,model:mode==='live'?model:null,workspace:path.basename(root),docker,liveReady:mode==='live'&&!!model&&!!process.env.OPENAI_API_KEY&&docker.available,runs:[...demo.runs.values(),...liveRuns.values()],currentRunId,maxTurns:8};}
  async function api(req:IncomingMessage,res:ServerResponse,url:URL){
    const method=req.method??'GET';
    if(closing)throw new HttpError(503,'The server is shutting down.');
    if(url.pathname==='/api/session'&&method==='GET'){security.check(req,false);json(res,200,security.bootstrap(res));return;}
    security.check(req);
    if(url.pathname==='/api/state'&&method==='GET'){json(res,200,state());return;}
    if(url.pathname==='/api/runs'&&method==='POST'){
      const body=await readJson(req);if(typeof body.prompt!=='string'||!body.prompt.trim()||body.prompt.length>8000)throw new HttpError(400,'Enter a task of 1–8,000 characters.');
      if(starting||state().runs.some(r=>r.status==='running'||r.status==='awaiting_approval'))throw new HttpError(409,'Finish or stop the current run before starting another.');
      starting=true;try {
      const all=state().runs;if(all.length>=20){const first=all[0];demo.runs.delete(first.id);liveRuns.delete(first.id);await sdk.dispose(first.id);runner.disposeRun(first.id);}
      const prompt=redactSdkText(body.prompt.trim());
      if(mode==='demo'){const run=demo.start(prompt);currentRunId=run.id;json(res,201,run);return;}
      const id=randomUUID();
      const run:Run={id,prompt,mode,status:'running',startedAt:Date.now(),activeAgent:'coordinator',messages:[{id:randomUUID(),author:'user',text:prompt,at:Date.now()}],events:[],approvals:[],artifacts:[],output:''};liveRuns.set(id,run);currentRunId=id;json(res,201,run);
      void (async()=>{
        const availability=await runner.checkAvailability();docker={available:availability.available,reason:availability.reason??'Ready'};
        if(run.status==='cancelled')return;
        if(!docker.available||!model||!process.env.OPENAI_API_KEY){onEvent({runId:id,type:'run_failed',at:new Date().toISOString(),message:'Live mode needs local Docker with the prepared image, an explicit model, and a server-side API key. Nothing has been sent to a model.'});return;}
        await runner.snapshot(id);
        if((run.status as string)==='cancelled')return;
        sync(await sdk.start({runId:id,prompt}));
      })().catch(()=>{if(run.status!=='cancelled')onEvent({runId:id,type:'run_failed',at:new Date().toISOString(),message:'The run failed safely. Review local configuration before starting another run.'});});return;
      } finally {starting=false;}
    }
    const route=/^\/api\/runs\/([a-zA-Z0-9-]+)\/(approval|stop)$/.exec(url.pathname);
    if(route&&method==='POST'){
      const [,id,operation]=route;const body=await readJson(req);const run=demo.runs.get(id)??liveRuns.get(id);if(!run)throw new HttpError(404,'Run expired or not found. Restarted servers do not retain approvals.');
      if(operation==='stop'){if(run.mode==='demo')demo.cancel(id);else {await sdk.cancel(id);runner.disposeRun(id);if(run.status==='running'||run.status==='awaiting_approval')onEvent({runId:id,type:'run_cancelled',at:new Date().toISOString(),message:'Stopped. Pending approvals are invalid.'});}json(res,200,{ok:true});return;}
      const {approvalId,digest,approved}=body;if(typeof approvalId!=='string'||typeof digest!=='string'||typeof approved!=='boolean')throw new HttpError(400,'An exact approval ID, digest, and explicit decision are required.');
      if(run.mode==='demo'){try{demo.decide(id,approvalId,digest,approved);}catch(e){throw new HttpError(409,(e as Error).message);}json(res,200,{ok:true});return;}
      const pending=run.approvals.find(a=>a.id===approvalId&&a.status==='pending');if(!pending||pending.digest!==digest||run.status!=='awaiting_approval')throw new HttpError(409,'This approval is stale, changed, or already used.');
      pending.status=approved?'approved':'denied';run.status='running';json(res,202,{ok:true});
      void sdk.resume({runId:id,approvalId,digest,approved}).then(sync).catch(()=>{onEvent({runId:id,type:'run_failed',at:new Date().toISOString(),message:'That approval could not be resumed. Start a new run; the old approval cannot be reused.'});});return;
    }
    throw new HttpError(404,'Endpoint not found.');
  }
  const server=createServer(async(req,res)=>{security.headers(res,!!options.production);try{const url=new URL(req.url??'/',`http://127.0.0.1:${options.port}`);security.check(req,false,url.pathname==='/');if(url.pathname.startsWith('/api/'))await api(req,res,url);else if(options.serve)await options.serve(req,res);else throw new HttpError(404,'Asset not found.');}catch(e){if(res.headersSent){res.end();return;}json(res,e instanceof HttpError?e.status:400,{error:e instanceof HttpError?e.message:'The request could not be completed safely.'});}});
  server.requestTimeout=15_000;server.headersTimeout=10_000;server.keepAliveTimeout=5_000;
  return {server,state,async close(){closing=true;demo.dispose();await Promise.all([...liveRuns.keys()].map(id=>sdk.cancel(id)));for(const id of liveRuns.keys())runner.disposeRun(id);const cleanup=await runner.shutdown();await new Promise<void>(resolve=>server.close(()=>resolve()));return cleanup;}};
}
