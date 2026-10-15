export type AgentId = 'coordinator' | 'scout' | 'maker' | 'checker';
export type RunStatus = 'idle'|'running'|'awaiting_approval'|'completed'|'denied'|'cancelled'|'failed';
export type Action = {kind:'edit';path:string;content:string} | {kind:'command';executable:'node'|'npm'|'ls'|'cat';args:string[];cwd?:string};
export interface Approval {id:string;digest:string;agent:AgentId;title:string;description:string;action:Action;status:'pending'|'approved'|'denied';before?:string}
export interface FleetEvent {id:string;at:number;agent:AgentId;kind:'message'|'delegation'|'tool'|'approval'|'result'|'error';title:string;detail?:string}
export interface Message {id:string;author:AgentId|'user';text:string;kind?:'text'|'delegation'|'result';at:number}
export interface Artifact {path:string;before:string;after:string;simulated:boolean}
export interface Run {id:string;prompt:string;status:RunStatus;mode:'demo'|'live';messages:Message[];events:FleetEvent[];approvals:Approval[];artifacts:Artifact[];output:string;activeAgent:AgentId|null;startedAt:number;endedAt?:number}
export interface AppState {mode:'demo'|'live';model:string|null;workspace:string;docker:{available:boolean;reason:string};liveReady:boolean;runs:Run[];currentRunId:string|null;maxTurns:number}
export const initialSource = 'export function sum(a, b) {\n  return a - b;\n}\n';
export const fixedSource = 'export function sum(a, b) {\n  return a + b;\n}\n';
