import {safeSources} from './sources.js';
import {constants,closeSync,existsSync,fsyncSync,fstatSync,lstatSync,mkdirSync,openSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {canonicalJson} from './approval.js';
import {validateParticipants,validateAvailableBots,validateProfiles} from './personas.js';
import {redactSdkText} from './safety.js';
import type {Conversation,Message,Persona,Run} from '../shared/types.js';

export const CONVERSATION_LIMITS=Object.freeze({conversations:100,runs:200,bytes:8*1024*1024,historyMessages:32,historyChars:16000});
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),time=z.number().finite().nonnegative();
const text=(max:number)=>z.string().max(max).transform(redactSdkText);
const role=z.enum(['coordinator','scout','maker','checker']);
const participants=z.unknown().transform(value=>validateParticipants(value));
const message=z.object({id,sources:z.unknown().transform(value=>safeSources(value)).optional(),createdAgentId:id.optional(),conversationId:id.optional(),author:z.enum(['user','coordinator','scout','maker','checker']),text:text(256000),at:time,kind:z.enum(['text','delegation','result']).optional()}).transform(value=>({...value,...(value.sources?{sources:safeSources(value.sources,value.text)}:{})}));
const action=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('edit'),path:text(512),content:text(256000)}),
 z.object({kind:z.literal('command'),resolvedExecutable:z.object({path:text(4096),identity:text(512)}).nullable().optional(),executable:text(4096),args:z.array(text(8192)).max(128),cwd:text(512).optional()}),
]);
const usageCount=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const runSchema=z.object({id,usage:z.object({modelCalls:usageCount,inputTokens:usageCount,outputTokens:usageCount,totalTokens:usageCount}).optional(),conversationId:id.optional(),team:participants.optional(),prompt:text(8000),status:z.enum(['idle','running','awaiting_approval','completed','denied','cancelled','failed']),mode:z.enum(['demo','live']),
 messages:z.array(message).max(1024),events:z.array(z.object({id,at:time,agent:role,kind:z.enum(['message','delegation','tool','approval','result','error']),title:text(4096),detail:text(256000).optional()})).max(2048),
 approvals:z.array(z.object({id,digest:z.string().max(128),agent:role,title:text(4096),description:text(4096),action,status:z.enum(['pending','approved','denied']),before:text(256000).optional()})).max(256),
 artifacts:z.array(z.object({path:text(512),before:text(256000),after:text(256000),simulated:z.boolean()})).max(256),output:text(256000),activeAgent:role.nullable(),startedAt:time,endedAt:time.optional()});
const conversationSchema=z.object({id,availableBots:z.unknown().transform(value=>validateAvailableBots(value)).optional(),startedBy:z.object({conversationId:id,runId:id,coordinatorId:id,brief:text(8000)}).optional(),title:text(80).refine(v=>!!v.trim()),participants,createdAt:time,updatedAt:time,draft:text(8000),currentRunId:id.nullable()});
export interface ConversationState {libraryImported:boolean;profiles:Persona[];version:1;conversations:Conversation[];runs:Run[]}
export function defaultParticipants():Persona[]{return validateParticipants(['coordinator','scout','maker','checker'].map(role=>({id:`default-${role}`,role,name:role[0].toUpperCase()+role.slice(1),purpose:`Follow the ${role} role in the coding workflow.`,color:'#567a75',shape:'orbit'})));}

/** Persist only explicitly listed public fields: never SDK state, grants, session cookies, or credentials. */
function normalize(input:unknown,restart:boolean):ConversationState {
 const envelope=z.object({libraryImported:z.boolean().optional(),profiles:z.unknown().transform(validateProfiles).optional(),version:z.literal(1).optional(),conversations:z.array(conversationSchema).max(CONVERSATION_LIMITS.conversations).optional(),runs:z.array(runSchema).max(CONVERSATION_LIMITS.runs)}).parse(input);
 const runs=envelope.runs as Run[];
 let conversations=envelope.conversations as Conversation[]|undefined;
 if(!conversations){
  conversations=runs.map(run=>{const chatId=randomUUID();run.conversationId=chatId;run.team=run.team??defaultParticipants();return {id:chatId,title:run.prompt.trim().slice(0,80)||'Imported chat',participants:run.team,createdAt:run.startedAt,updatedAt:run.endedAt??run.startedAt,draft:'',currentRunId:run.id};});
 }
 if(conversations.length>CONVERSATION_LIMITS.conversations||new Set(conversations.map(c=>c.id)).size!==conversations.length||new Set(runs.map(r=>r.id)).size!==runs.length)throw new Error('Invalid conversation identities.');
 for(const run of runs){
  const chat=conversations.find(c=>c.id===run.conversationId);
  if(!chat)throw new Error('Run references an unknown conversation.');
  if(!run.team||canonicalJson(run.team)!==canonicalJson(chat.participants))throw new Error('Run participants do not match the conversation.');
  if(restart){
   const active=run.status==='running'||run.status==='awaiting_approval';
   if(active){run.status='cancelled';run.activeAgent=null;run.endedAt=Date.now();run.messages.push({id:randomUUID(),author:run.team?.[0]?.role??'coordinator',text:'The server restarted. This run was stopped; old approvals cannot execute. Send a new message to continue.',at:Date.now()});}
   for(const approval of run.approvals)if(approval.status==='pending'||(active&&approval.status==='approved'))approval.status='denied';
  }
 }
 const origins=new Set<string>();
 for(const chat of conversations){
  if(chat.currentRunId&&!runs.some(run=>run.id===chat.currentRunId&&run.conversationId===chat.id))throw new Error('Conversation references a foreign run.');
  if(chat.availableBots!==undefined&&(chat.participants.length!==1||chat.participants[0].role!=='coordinator'||chat.startedBy))throw new Error('Only direct coordinators have a specialist roster.');
  if(chat.availableBots?.some(bot=>bot.id===chat.participants[0].id))throw new Error('Roster identity conflicts with the coordinator.');
  if(chat.startedBy){
   const origin=chat.startedBy,source=conversations.find(c=>c.id===origin.conversationId),sourceRun=runs.find(r=>r.id===origin.runId);
   if(!source||source.startedBy||source.participants.length!==1||source.participants[0].role!=='coordinator'||source.participants[0].id!==origin.coordinatorId||sourceRun?.conversationId!==source.id||origins.has(origin.runId)||chat.id===source.id)throw new Error('Invalid group provenance.');
   origins.add(origin.runId);
   if(chat.participants.length<2||chat.participants[0].role!=='coordinator'||canonicalJson(chat.participants[0])!==canonicalJson(source.participants[0]))throw new Error('Group coordinator does not match its source.');
   for(const bot of chat.participants.slice(1))if(!source.availableBots?.some(candidate=>canonicalJson(candidate)===canonicalJson(bot)))throw new Error('Group specialist is not in its source roster.');
  }
 }
 for(const run of runs)for(const message of run.messages)if(message.conversationId){const target=conversations.find(c=>c.id===message.conversationId);if(message.author!=='coordinator'||target?.startedBy?.runId!==run.id||target.startedBy.conversationId!==run.conversationId)throw new Error('Invalid conversation link.');}

 const profiles=envelope.profiles??validateProfiles([...new Map((conversations.length?conversations.flatMap(c=>[...c.participants,...(c.availableBots??[])]):[]).map(p=>[p.id,p])).values()]);
 return {version:1,conversations,runs,profiles,libraryImported:envelope.libraryImported??false};
}

export function conversationHistory(conversationId:string,runs:readonly Run[]):Message[]{
 const messages=runs.filter(r=>r.conversationId===conversationId&&!['running','awaiting_approval'].includes(r.status)).sort((a,b)=>a.startedAt-b.startedAt).flatMap(r=>r.messages);
 let remaining=CONVERSATION_LIMITS.historyChars;const selected:Message[]=[];
 for(let i=messages.length-1;i>=0&&remaining>0&&selected.length<CONVERSATION_LIMITS.historyMessages;i--){const m=messages[i],safe=redactSdkText(m.text);const content=safe.slice(-remaining);remaining-=content.length;selected.unshift({...m,text:content});}
 return selected;
}

/** A corrupt file aborts startup unchanged. Saving replaces a private file atomically. */
export class ConversationStore {
 readonly state:ConversationState;
 private lastSaved='';
 constructor(private readonly statePath?:string,initialRuns:Run[]=[]){
  try{
   let input:unknown={runs:initialRuns};
   if(statePath&&existsSync(statePath)){
    const fd=openSync(statePath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>CONVERSATION_LIMITS.bytes)throw new Error('Invalid state file.');input=JSON.parse(readFileSync(fd,'utf8'));}finally{closeSync(fd);}
   }
   this.state=normalize(input,true);
  }catch(error){if(error instanceof Error&&error.message==='The bot library allows up to 32 profiles.')throw new Error('Saved history contains more than 32 bot profiles. All saved data was left unchanged; reduce or export the library before starting.');throw new Error('Conversation history could not be read safely. The saved file was left unchanged; restore or repair it before starting.');}
 }
 save(conversations:Conversation[],runs:Run[],profiles:Persona[]=this.state.profiles,libraryImported=this.state.libraryImported):void {
  if(!this.statePath)return;
  const serialized=JSON.stringify(normalize({version:1,conversations,runs,profiles,libraryImported},false));
  if(Buffer.byteLength(serialized)>CONVERSATION_LIMITS.bytes)throw new Error('Conversation storage limit reached.');
  if(serialized===this.lastSaved)return;
  const directory=path.dirname(this.statePath);mkdirSync(directory,{recursive:true,mode:0o700});
  const dirStat=lstatSync(directory);if(!dirStat.isDirectory()||dirStat.isSymbolicLink())throw new Error('Invalid conversation directory.');
  if(existsSync(this.statePath)){const stat=lstatSync(this.statePath);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw new Error('Invalid conversation file.');}
  const temporary=path.join(directory,`.conversations-${randomUUID()}.tmp`);let fd:number|undefined;
  try{fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);writeFileSync(fd,serialized);fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temporary,this.statePath);this.lastSaved=serialized;}
  finally{if(fd!==undefined)closeSync(fd);try{unlinkSync(temporary);}catch{}}
 }
}


export function selectCoordinatorGroup(source:Conversation,run:Run,input:unknown):{title:string;brief:string;participants:Persona[]}{
 if(source.startedBy||source.participants.length!==1||source.participants[0].role!=='coordinator'||run.conversationId!==source.id||run.status!=='running'||canonicalJson(run.team)!==canonicalJson(source.participants))throw new Error('Only an active direct coordinator can start a group.');
 const request=z.object({title:z.string().trim().min(1).max(80).refine(value=>!/[\u0000-\u001f\u007f]/.test(value)),brief:z.string().trim().min(1).max(8000),botIds:z.array(id).min(1).max(3)}).strict().parse(input);
 if(new Set(request.botIds).size!==request.botIds.length)throw new Error('Select distinct available specialists.');
 const selected=request.botIds.map(id=>{const bot=source.availableBots?.find(p=>p.id===id);if(!bot)throw new Error('Requested specialist is not available.');return bot;});
 const participants=validateParticipants([source.participants[0],...selected]);
 const title=redactSdkText(request.title),brief=redactSdkText(request.brief);
 if(title.length>80||brief.length>8000)throw new Error('Redacted group metadata exceeds its limit.');
 return {title,brief,participants};
}
