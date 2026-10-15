import type {Persona,AgentId} from '../src/shared/types.js';
export function customTeam():Persona[]{return (['coordinator','scout','maker','checker'] as AgentId[]).map((role,index)=>({id:`custom-${role}`,name:`Bot ${index+1}`,purpose:`Focus on ${role} clarity.`,role,color:'#3a7d82',shape:'orbit'}));}
