import type {Persona,AgentId} from '../shared/types.js';
import {canonicalJson} from './approval.js';
import {redactSdkText} from './safety.js';
const roles:AgentId[]=['coordinator','scout','maker','checker'];
/** Profiles customize identity and focus, never a role's capabilities. */
export function validateTeam(input:unknown):Persona[]|undefined {
 if(input===undefined)return undefined;
 const team=validateParticipants(input);
 if(team.length!==4)throw new Error('Choose four bot profiles, one for each role.');
 return team;
}
export function validateParticipants(input:unknown):Persona[] {
 const invalid=()=>new Error('Choose one to four valid bot profiles with unique roles and IDs. Names allow 40 characters and purposes 600; credentials are not allowed.');
 let value:unknown;
 try{value=JSON.parse(canonicalJson(input));}catch{throw invalid();}
 if(!Array.isArray(value)||(value.length<1||value.length>4))throw invalid();
 const ids=new Set<string>(),assigned=new Set<string>();
 const team=value.map((entry:unknown)=>{
  if(!entry||typeof entry!=='object'||Array.isArray(entry))throw invalid();
  const p=entry as Record<string,unknown>;
  if(Object.keys(p).some(key=>!['id','name','purpose','role','color','shape'].includes(key)))throw invalid();
  if(typeof p.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(p.id)||ids.has(p.id))throw invalid();
  if(typeof p.role!=='string'||!roles.includes(p.role as AgentId)||assigned.has(p.role))throw invalid();
  if(typeof p.name!=='string'||!p.name.trim()||p.name.trim().length>40||typeof p.purpose!=='string'||!p.purpose.trim()||p.purpose.trim().length>600)throw invalid();
  if(/[\u0000-\u001f\u007f]/.test(p.name)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(p.purpose)||redactSdkText(p.name)!==p.name||redactSdkText(p.purpose)!==p.purpose)throw invalid();
  if(typeof p.color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(p.color)||typeof p.shape!=='string'||!['orbit','spark','pebble','gem'].includes(p.shape))throw invalid();
  ids.add(p.id);assigned.add(p.role);
  return Object.freeze({id:p.id,name:p.name.trim(),purpose:p.purpose.trim(),role:p.role as AgentId,color:p.color,shape:p.shape as Persona['shape']});
 });
 return Object.freeze(team) as unknown as Persona[];
}

/** A direct coordinator's frozen roster may contain alternatives for the same specialist role. */
export function validateAvailableBots(input:unknown):Persona[]{
 if(!Array.isArray(input)||input.length>32)throw new Error('Choose up to 32 available specialist bots.');
 const ids=new Set<string>();
 const profiles=input.map(value=>{const profile=validateParticipants([value])[0];if(profile.role==='coordinator'||ids.has(profile.id))throw new Error('Available bots must be specialists with unique IDs.');ids.add(profile.id);return profile;});
 return Object.freeze(profiles) as unknown as Persona[];
}
