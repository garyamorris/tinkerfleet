import type { Persona, PersonaRole } from '../src/shared/types.js';
export function customTeam(): Persona[] {
  return (['coordinator', 'scout', 'maker', 'checker'] as PersonaRole[]).map((role, index) => ({
    id: `custom-${role}`,
    name: `Bot ${index + 1}`,
    purpose: `Focus on ${role} clarity.`,
    role,
    color: '#3a7d82',
    shape: 'orbit',
  }));
}
