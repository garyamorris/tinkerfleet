import type {Persona} from './types.js';
type Appearance=Pick<Persona,'color'|'shape'>;
export const appearanceColors=['#3978b8','#567a75','#8b68aa','#b77b42','#a65e77','#4b8790','#768448','#806f62'] as const;
export const appearanceShapes=['orbit','spark','pebble','gem'] as const;
/** New identities only. A reroll excludes the previous pair without changing it. */
export function randomAppearance(previous?:Appearance):Appearance {
 const choices:Appearance[]=appearanceColors.flatMap(color=>appearanceShapes.map(shape=>({color,shape}))).filter(choice=>choice.color!==previous?.color.toLowerCase()||choice.shape!==previous.shape);
 const range=2**32,limit=range-range%choices.length,buffer=new Uint32Array(1);let draw:number;
 do{globalThis.crypto.getRandomValues(buffer);draw=buffer[0];}while(draw>=limit);
 return {...choices[draw%choices.length]};
}
