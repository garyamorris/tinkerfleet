import {validateTeam} from './personas.js';
import type {Persona} from '../shared/types.js';
import {randomUUID,createHash} from 'node:crypto';
import type {Approval,Run,AgentId,Action,FleetEvent} from '../shared/types.js';
import {initialSource,fixedSource} from '../shared/types.js';
/** A deterministic teaching fixture, never a model or execution backend. */
export class DemoEngine {
  readonly runs = new Map<string,Run>();
  private timers = new Map<string,ReturnType<typeof setTimeout>>();
  constructor(private delayMs=650) {}
  start(prompt:string,team?:Persona[]):Run {
    const runTeam=validateTeam(team);
    const run:Run={...(runTeam?{team:runTeam}:{}),id:randomUUID(),prompt,status:'running',mode:'demo',messages:[],events:[],approvals:[],artifacts:[],output:'',activeAgent:'coordinator',startedAt:Date.now()};
    const names=this.names(run);
    this.runs.set(run.id,run);
    this.message(run,'user',prompt);
    this.message(run,'coordinator',`Let’s fix the tiny project together. ${names.scout} will inspect the code, ${names.maker} will propose a change, and ${names.checker} will verify it. You’ll review each action before we continue.`);
    this.event(run,'coordinator','delegation',`${names.scout}, take a look`,`${names.coordinator} → ${names.scout} · inspect the fixture`);
    this.later(run,()=>{
      run.activeAgent='scout';
      this.event(run,'scout','tool','Read sum.js','Simulated read · 3 lines · tiny-project');
      this.message(run,'scout','Found it. sum() subtracts b from a. The tests expect addition, so one operator needs to change. No files have been edited.');
      this.later(run,()=>{
        run.activeAgent='maker';
        this.event(run,'coordinator','delegation',`${names.maker}, propose the fix`,`${names.scout} returned findings to ${names.coordinator}`);
        this.message(run,'maker','A one-character fix should do it. Here’s the exact change I’d make in the disposable workspace.');
        this.request(run,{kind:'edit',path:'sum.js',content:fixedSource},'maker','Update sum.js','Change subtraction to addition. Original files stay untouched.',initialSource);
      });
    });
    return run;
  }
  private names(run:Run){return Object.fromEntries((['coordinator','scout','maker','checker'] as AgentId[]).map(role=>[role,run.team?.find(persona=>persona.role===role)?.name??role[0].toUpperCase()+role.slice(1)])) as Record<AgentId,string>;}
  private later(run:Run,fn:()=>void){const timer=setTimeout(()=>{this.timers.delete(run.id);if(run.status==='running')fn();},this.delayMs);this.timers.set(run.id,timer);}
  private message(run:Run,author:AgentId|'user',text:string,kind:'text'|'delegation'|'result'='text'){run.messages.push({id:randomUUID(),author,text,kind,at:Date.now()});}
  private event(run:Run,agent:AgentId,kind:FleetEvent['kind'],title:string,detail?:string){run.events.push({id:randomUUID(),agent,kind,title,detail,at:Date.now()});}
  private request(run:Run,action:Action,agent:AgentId,title:string,description:string,before?:string){
    const id=randomUUID(),digest=createHash('sha256').update(JSON.stringify({runId:run.id,id,action})).digest('hex');
    run.approvals.push({id,digest,agent,title,description,action,status:'pending',before});run.status='awaiting_approval';
    this.event(run,agent,'approval','Your approval is needed',title);
  }
  decide(runId:string,id:string,digest:string,approved:boolean):Run {
    const run=this.runs.get(runId);if(!run)throw new Error('Run not found or expired after restart.');const names=this.names(run);
    const approval=run.approvals.find(a=>a.id===id);
    if(run.status!=='awaiting_approval'||!approval||approval.status!=='pending'||approval.digest!==digest)throw new Error('This approval is stale, changed, or already used.');
    approval.status=approved?'approved':'denied';
    if(!approved){run.status='denied';run.activeAgent=null;run.endedAt=Date.now();this.event(run,approval.agent,'result','Action declined','No action was performed.');this.message(run,'coordinator','Understood. I’ve stopped here. That action wasn’t performed, and your original project is unchanged.');return run;}
    run.status='running';this.event(run,approval.agent,'result','Approved for this action only',`Action fingerprint ${digest.slice(0,12)} · consumed once`);
    if(approval.action.kind==='edit'){
      run.artifacts.push({path:'sum.js',before:initialSource,after:fixedSource,simulated:true});
      this.event(run,'maker','result','Simulated patch applied','In-memory demo fixture only');
      this.message(run,'maker',`The demo patch is ready. I’ve returned the change to ${names.coordinator} for a check.`);
      this.later(run,()=>{run.activeAgent='checker';this.event(run,'coordinator','delegation',`${names.checker}, verify the change`,`${names.coordinator} → ${names.checker} · independent verification`);this.message(run,'checker','I’ll run the project’s three tests in an isolated workspace. This demo will show a simulated test result.');this.request(run,{kind:'command',executable:'node',args:['--test','sum.test.js'],cwd:'.'},'checker','Run the test suite','One command. No network. 15-second timeout. Demo output is simulated.');});
    }else{
      run.activeAgent='checker';this.event(run,'checker','tool','Simulating node --test sum.test.js','No command is running on this computer');
      this.later(run,()=>{run.output='[SIMULATED DEMO OUTPUT]\n$ node --test sum.test.js\n\n✔ adds two positive numbers\n✔ handles negative numbers\n✔ adds zero\n\ntests 3   pass 3   fail 0\nexit code 0\n';run.status='completed';run.activeAgent=null;run.endedAt=Date.now();this.event(run,'checker','result','3 of 3 tests pass · simulated','Expected fixture output; not a real Docker run');this.message(run,'checker','All three fixture tests pass in the simulation. The patch is one line, and no extra files changed.');this.message(run,'coordinator',`Small fix, full loop. ${names.scout} found the issue, ${names.maker} proposed it, and ${names.checker} verified the expected result. You stayed in control of both actions. The diff and simulated output are in Details.`,'result');});
    }
    return run;
  }
  cancel(id:string){const run=this.runs.get(id);if(!run)throw new Error('Run not found.');if(!['running','awaiting_approval'].includes(run.status))return run;clearTimeout(this.timers.get(id));this.timers.delete(id);run.approvals.filter(a=>a.status==='pending').forEach(a=>a.status='denied');run.status='cancelled';run.activeAgent=null;run.endedAt=Date.now();this.event(run,'coordinator','result','Run stopped','Outstanding approvals invalidated');this.message(run,'coordinator','Stopped. Any pending approvals are now invalid. Start a new run whenever you’re ready.');return run;}
  dispose(){for(const id of this.runs.keys())this.cancel(id);this.runs.clear();}
}
