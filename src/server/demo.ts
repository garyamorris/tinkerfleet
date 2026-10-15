import {validateParticipants,validateAvailableBots} from './personas.js';
import {randomUUID,createHash} from 'node:crypto';
import type {Persona,Run,AgentId,Action,FleetEvent} from '../shared/types.js';
import {initialSource,fixedSource} from '../shared/types.js';

/** Deterministic, participant-aware lessons. Never calls a model or a command. */
export class DemoEngine {
  readonly runs = new Map<string,Run>();
  private timers = new Map<string,ReturnType<typeof setTimeout>>();
  constructor(private delayMs=650, private startGroup?:(runId:string,request:{title:string;brief:string;botIds:string[]})=>Promise<{conversationId:string;title:string}>) {}

  start(prompt:string,team?:Persona[],options:{availableBots?:Persona[];promptAuthor?:AgentId|'user'}={}):Run {
    const runTeam=team===undefined?undefined:validateParticipants(team);
    const run:Run={...(runTeam?{team:runTeam}:{}),id:randomUUID(),prompt,status:'running',mode:'demo',messages:[],events:[],approvals:[],artifacts:[],output:'',activeAgent:null,startedAt:Date.now()};
    const availableBots=options.availableBots===undefined?undefined:validateAvailableBots(options.availableBots);
    this.runs.set(run.id,run);
    this.message(run,options.promptAuthor??'user',prompt);
    if(runTeam?.length===1&&runTeam[0].role==='coordinator'&&availableBots!==undefined){
      run.activeAgent='coordinator';
      this.message(run,'coordinator','I’m your primary bot. We can work through a request here, and I can bring specialists together when a shared conversation would help.');
      this.later(run,()=>{void this.coordinate(run,availableBots);});
      return run;
    }
    const names=this.names(run);
    if(this.has(run,'coordinator')){
      run.activeAgent='coordinator';
      const full=['scout','maker','checker'].every(role=>this.has(run,role as AgentId));
      this.message(run,'coordinator',full
        ?`Let’s fix the tiny project together. ${names.scout} will inspect the code, ${names.maker} will propose a change, and ${names.checker} will verify it. You’ll review each action before we continue.`
        :this.roles(run).length===1
          ?'In this scripted planning lesson, the tiny project adds numbers incorrectly. The plan is to inspect sum.js, change subtraction to addition, then verify the tests. This is a direct conversation with me; I will not call bots who are not in this chat.'
          :`This scripted walkthrough uses only this conversation’s participants: ${this.roles(run).map(role=>names[role]).join(', ')}. I’ll coordinate their selected roles. Every proposed action still needs your approval.`);
    }
    this.later(run,()=>this.inspect(run));
    return run;
  }


  /** This is a visible teaching script, not a model deciding how to collaborate. */
  private async coordinate(run:Run,availableBots:Persona[]){
    const asksForTeam=/\b(fix|build|implement|debug|test|tests|review|collaborate|team|group)\b/i.test(run.prompt);
    const staysDirect=/\b(?:do not|don't|without|no)\b[^.!?]{0,45}\b(?:group|team|specialists?|collaborat\w*)\b/i.test(run.prompt);
    const selected=(['scout','maker','checker'] as const).flatMap(role=>{const bot=availableBots.find(p=>p.role===role);return bot?[bot]:[];});
    if(!asksForTeam||staysDirect||selected.length===0||!this.startGroup){
      this.message(run,'coordinator',selected.length
        ?'We can keep this conversation between us. In the no-key demo, ask me to fix the failing tests in tiny-project to see me bring specialists into a shared conversation.'
        :'We can keep planning here. Add a specialist to your bot library and start a new conversation with me to try the coordinated demo.','result');
      run.status='completed';run.activeAgent=null;run.endedAt=Date.now();
      this.event(run,'coordinator','result','Primary conversation complete','Scripted response · no specialist contacted');return;
    }
    this.message(run,'coordinator',`For this scripted example, I’ll bring ${selected.map(p=>p.name).join(', ')} into a shared conversation to investigate tiny-project. I’ll share a short task brief; this private conversation stays here.`,'delegation');
    try{
      await this.startGroup(run.id,{title:'Tiny-project repair',brief:'Investigate the failing addition tests in tiny-project. Inspect the fixture, propose the smallest fix, and verify it. Ask for approval before any edit or command.',botIds:selected.map(p=>p.id)});
      if(run.status!=='running')return;
      run.status='completed';run.activeAgent=null;run.endedAt=Date.now();
      this.event(run,'coordinator','delegation','Started a shared conversation','Selected specialist IDs · task brief only · scripted demo');
    }catch{
      if(run.status!=='running')return;
      run.status='failed';run.activeAgent=null;run.endedAt=Date.now();
      this.message(run,'coordinator','I could not start that shared conversation. No edit or command was approved here. Check the workspace status and try again.');
      this.event(run,'coordinator','error','Shared conversation could not start','The request failed safely.');
    }
  }

  private roles(run:Run):AgentId[]{return run.team?.map(p=>p.role)??['coordinator','scout','maker','checker'];}
  private has(run:Run,role:AgentId){return this.roles(run).includes(role);}
  private speaker(run:Run):AgentId{return this.has(run,'coordinator')?'coordinator':this.roles(run).at(-1)!;}
  private names(run:Run){return Object.fromEntries((['coordinator','scout','maker','checker'] as AgentId[]).map(role=>[role,run.team?.find(persona=>persona.role===role)?.name??role[0].toUpperCase()+role.slice(1)])) as Record<AgentId,string>;}
  private later(run:Run,fn:()=>void){const timer=setTimeout(()=>{this.timers.delete(run.id);if(run.status==='running')fn();},this.delayMs);this.timers.set(run.id,timer);}
  private message(run:Run,author:AgentId|'user',text:string,kind:'text'|'delegation'|'result'='text'){run.messages.push({id:randomUUID(),author,text,kind,at:Date.now()});}
  private event(run:Run,agent:AgentId,kind:FleetEvent['kind'],title:string,detail?:string){run.events.push({id:randomUUID(),agent,kind,title,detail,at:Date.now()});}
  private beginRole(run:Run,role:AgentId,title:string,detail:string){
    run.activeAgent=role;
    if(this.has(run,'coordinator'))this.event(run,'coordinator','delegation',title,detail);
    else this.event(run,role,'message',`${this.names(run)[role]} is responding`,'Selected participant · scripted demo');
  }
  private inspect(run:Run){
    const names=this.names(run);
    if(this.has(run,'scout')){
      this.beginRole(run,'scout',`${names.scout}, take a look`,`${names.coordinator} → ${names.scout} · inspect the fixture`);
      this.event(run,'scout','tool','Read sum.js','Simulated read · 3 lines · tiny-project');
      this.message(run,'scout','Found it. sum() subtracts b from a. The tests expect addition, so one operator needs to change. No files have been edited.');
      this.later(run,()=>this.propose(run));
    }else this.propose(run);
  }
  private propose(run:Run){
    if(!this.has(run,'maker')){this.verify(run);return;}
    const names=this.names(run);
    this.beginRole(run,'maker',`${names.maker}, propose the fix`,this.has(run,'scout')?`${names.scout} returned findings to ${names.coordinator}`:`${names.coordinator} → ${names.maker} · propose the fixture edit`);
    this.message(run,'maker','A one-character fix should do it. Here’s the exact change I’d make in the disposable workspace.');
    this.request(run,{kind:'edit',path:'sum.js',content:fixedSource},'maker','Update sum.js','Change subtraction to addition. Original files stay untouched.',initialSource);
  }
  private verify(run:Run){
    if(!this.has(run,'checker')){this.finish(run);return;}
    const names=this.names(run);
    this.beginRole(run,'checker',`${names.checker}, verify the change`,`${names.coordinator} → ${names.checker} · independent verification`);
    this.message(run,'checker',run.artifacts.length
      ?'I’ll run the project’s three tests in an isolated workspace. This demo will show a simulated test result.'
      :'This conversation has not applied an edit in this run. The original tiny-project fixture still subtracts, so the simulated tests will report the bug. I’ll ask for approval before showing that command result.');
    this.request(run,{kind:'command',executable:'node',args:['--test','sum.test.js'],cwd:'.'},'checker','Run the test suite','One command. No network. 15-second timeout. Demo output is simulated.');
  }
  private request(run:Run,action:Action,agent:AgentId,title:string,description:string,before?:string){
    const id=randomUUID(),digest=createHash('sha256').update(JSON.stringify({runId:run.id,id,action})).digest('hex');
    run.approvals.push({id,digest,agent,title,description,action,status:'pending',before});run.status='awaiting_approval';
    this.event(run,agent,'approval','Your approval is needed',title);
  }
  private finish(run:Run){
    run.status='completed';run.activeAgent=null;run.endedAt=Date.now();
    const names=this.names(run),full=['coordinator','scout','maker','checker'].every(role=>this.has(run,role as AgentId));
    const summary=full
      ?`Small fix, full loop. ${names.scout} found the issue, ${names.maker} proposed it, and ${names.checker} verified the expected result. You stayed in control of both actions. The diff and simulated output are in Details.`
      :run.artifacts.length
        ?`This conversation’s scripted edit is complete.${this.has(run,'checker')?' The selected reviewer checked the expected result.':' No reviewer participated, so no test command was requested.'} The demo artifact is in Details; no real file was changed.`
        :this.has(run,'checker')
          ?'The scripted check is complete. The unchanged fixture still contains the bug. No other chat’s edits or artifacts were used.'
          :'That completes this read-only scripted lesson. No edit or command was requested, and no other bots joined this conversation.';
    this.message(run,this.speaker(run),summary,'result');
    this.event(run,this.speaker(run),'result','Scripted response complete','Only selected participants · no model calls');
  }
  decide(runId:string,id:string,digest:string,approved:boolean):Run {
    const run=this.runs.get(runId);if(!run)throw new Error('Run not found or expired after restart.');
    const approval=run.approvals.find(a=>a.id===id);
    if(run.status!=='awaiting_approval'||!approval||approval.status!=='pending'||approval.digest!==digest)throw new Error('This approval is stale, changed, or already used.');
    approval.status=approved?'approved':'denied';
    if(!approved){run.status='denied';run.activeAgent=null;run.endedAt=Date.now();this.event(run,approval.agent,'result','Action declined','No action was performed.');this.message(run,this.speaker(run),'Understood. I’ve stopped here. That action wasn’t performed, and your original project is unchanged.');return run;}
    run.status='running';this.event(run,approval.agent,'result','Approved for this action only',`Action fingerprint ${digest.slice(0,12)} · consumed once`);
    if(approval.action.kind==='edit'){
      run.artifacts.push({path:'sum.js',before:initialSource,after:fixedSource,simulated:true});
      this.event(run,'maker','result','Simulated patch applied','In-memory demo fixture only');
      this.message(run,'maker',this.has(run,'coordinator')?`The demo patch is ready. I’ve returned the change to ${this.names(run).coordinator} for a check.`:'The demo patch is ready in this run’s fixture. No real file was written.');
      this.later(run,()=>this.verify(run));
    }else{
      run.activeAgent='checker';this.event(run,'checker','tool','Simulating node --test sum.test.js','No command is running on this computer');
      this.later(run,()=>{
        const fixed=run.artifacts.some(a=>a.path==='sum.js'&&a.after===fixedSource);
        run.output=fixed?'[SIMULATED DEMO OUTPUT]\n$ node --test sum.test.js\n\n✔ adds two positive numbers\n✔ handles negative numbers\n✔ adds zero\n\ntests 3   pass 3   fail 0\nexit code 0\n':'[SIMULATED DEMO OUTPUT]\n$ node --test sum.test.js\n\nFixture bug detected: sum() subtracts instead of adding.\nNo approved edit exists in this run.\nexit code 1\n';
        this.event(run,'checker','result',fixed?'3 of 3 tests pass · simulated':'Fixture bug detected · simulated','Expected fixture output; not a real Docker run');
        this.message(run,'checker',fixed?'All three fixture tests pass in the simulation. The patch is one line, and no extra files changed.':'The simulation reports the original addition bug. This run has no approved edit; another conversation’s changes do not apply here.');
        this.finish(run);
      });
    }
    return run;
  }
  cancel(id:string){const run=this.runs.get(id);if(!run)throw new Error('Run not found.');if(!['running','awaiting_approval'].includes(run.status))return run;clearTimeout(this.timers.get(id));this.timers.delete(id);run.approvals.filter(a=>a.status==='pending').forEach(a=>a.status='denied');run.status='cancelled';run.activeAgent=null;run.endedAt=Date.now();this.event(run,this.speaker(run),'result','Run stopped','Outstanding approvals invalidated');this.message(run,this.speaker(run),'Stopped. Any pending approvals are now invalid. Start a new run whenever you’re ready.');return run;}
  dispose(){for(const id of this.runs.keys())this.cancel(id);this.runs.clear();}
}
