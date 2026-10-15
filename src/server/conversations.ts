import {constants,closeSync,existsSync,fsyncSync,fstatSync,lstatSync,mkdirSync,openSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {canonicalJson} from './approval.js';
import {validateParticipants} from './personas.js';
import {redactSdkText} from './safety.js';
import type {Conversation,Message,Persona,Run} from '../shared/types.js';

export const CONVERSATION_LIMITS=Object.freeze({conversations:100,runs:200,bytes:8*1024*1024,historyMessages:32,historyChars:16000});
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),time=z.number().finite().nonnegative();
const text=(max:number)=>z.string().max(max).transform(redactSdkText);
const role=z.enum(['coordinator','scout','maker','checker']);
const participants=z.unknown().transform(value=>validateParticipants(value));
const message=z.object({id,author:z.enum(['user','coordinator','scout','maker','checker']),text:text(256000),at:time,kind:z.enum(['text','delegation','result']).optional()});
const action=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('edit'),path:text(512),content:text(256000)}),
 z.object({kind:z.literal('command'),executable:z.enum(['node','npm','ls','cat']),args:z.array(text(4096)).max(32),cwd:text(512).optional()}),
]);
const runSchema=z.object({id,conversationId:id.optional(),team:participants.optional(),prompt:text(8000),status:z.enum(['idle','running','awaiting_approval','completed','denied','cancelled','failed']),mode:z.enum(['demo','live']),
 messages:z.array(message).max(1024),events:z.array(z.object({id,at:time,agent:role,kind:z.enum(['message','delegation','tool','approval','result','error']),title:text(4096),detail:text(256000).optional()})).max(2048),
 approvals:z.array(z.object({id,digest:z.string().max(128),agent:role,title:text(4096),description:text(4096),action,status:z.enum(['pending','approved','denied']),before:text(256000).optional()})).max(256),
 artifacts:z.array(z.object({path:text(512),before:text(256000),after:text(256000),simulated:z.boolean()})).max(256),output:text(256000),activeAgent:role.nullable(),startedAt:time,endedAt:time.optional()});
const conversationSchema=z.object({id,title:text(80).refine(v=>!!v.trim()),participants,createdAt:time,updatedAt:time,draft:text(8000),currentRunId:id.nullable()});
export interface ConversationState {version:1;conversations:Conversation[];runs:Run[]}
export function defaultParticipants():Persona[]{return validateParticipants(['coordinator','scout','maker','checker'].map(role=>({id:`default-${role}`,role,name:role[0].toUpperCase()+role.slice(1),purpose:`Follow the ${role} role in the coding workflow.`,color:'#567a75',shape:'orbit'})));}

/** Persist only explicitly listed public fields: never SDK state, grants, session cookies, or credentials. */
function normalize(input:unknown,restart:boolean):ConversationState {
 const envelope=z.object({version:z.literal(1).optional(),conversations:z.array(conversationSchema).max(CONVERSATION_LIMITS.conversations).optional(),runs:z.array(runSchema).max(CONVERSATION_LIMITS.runs)}).parse(input);
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
 for(const chat of conversations)if(chat.currentRunId&&!runs.some(run=>run.id===chat.currentRunId&&run.conversationId===chat.id))throw new Error('Conversation references a foreign run.');
 return {version:1,conversations,runs};
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
  }catch{throw new Error('Conversation history could not be read safely. The saved file was left unchanged; restore or repair it before starting.');}
 }
 save(conversations:Conversation[],runs:Run[]):void {
  if(!this.statePath)return;
  const serialized=JSON.stringify(normalize({version:1,conversations,runs},false));
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
