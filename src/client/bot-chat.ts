import type {Conversation,Persona} from '../shared/types';
export async function directBotChat(bot:Persona,conversations:Conversation[],profiles:Persona[],create:(body:unknown)=>Promise<Conversation>){
 const existing=conversations.filter(c=>c.participants.length===1&&c.participants[0].id===bot.id).sort((a,b)=>b.updatedAt-a.updatedAt)[0];
 if(existing)return existing;
 return create({title:bot.name,participants:[bot],...(bot.role==='coordinator'?{availableBots:profiles.filter(p=>p.role!=='coordinator')}: {})});
}
