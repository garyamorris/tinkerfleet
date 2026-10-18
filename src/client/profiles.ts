/** Bot profiles: the starter team, the legacy browser library, and display helpers. */
import type { Persona } from '../shared/types';
import { appearanceShapes as shapes } from '../shared/appearance';

export type Shape = 'orbit' | 'spark' | 'pebble' | 'gem';
export type Person = {
  id: string;
  name: string;
  role: string;
  color: string;
  shape: Shape;
  description: string;
};
export const defaults: Person[] = [
  {
    id: 'coordinator',
    name: 'Orbit',
    role: 'Primary agent',
    color: '#7563de',
    shape: 'orbit',
    description:
      'Keeps the plan, talks with individual agents, and brings the results back to you.',
  },
  {
    id: 'scout',
    name: 'Scout',
    role: 'Agent',
    color: '#368cda',
    shape: 'spark',
    description: 'Curious and thorough. Gathers evidence and explains what it means.',
  },
  {
    id: 'maker',
    name: 'Maker',
    role: 'Agent',
    color: '#e99149',
    shape: 'pebble',
    description: 'Practical and inventive. Turns ideas into useful work and explains each step.',
  },
  {
    id: 'checker',
    name: 'Checker',
    role: 'Agent',
    color: '#399d7b',
    shape: 'gem',
    description: 'Careful and candid. Checks assumptions and points out what could improve.',
  },
];
const legacyRoleIds = ['coordinator', 'scout', 'maker', 'checker'];
export const starterProfiles: Persona[] = defaults.map((p) => ({
  id: `starter-${p.id}`,
  role: p.id === 'coordinator' ? 'coordinator' : 'agent',
  name: p.name,
  purpose: p.description,
  color: p.color,
  shape: p.shape,
}));
export type Library = { profiles: Persona[]; assignments: Record<string, string> };
export function agentLabel(p: Persona) {
  return p.role === 'coordinator' ? 'Primary agent' : 'Agent';
}
export function resolveAgent(id: string, ...pools: Persona[][]): Persona {
  const candidates = pools.flat();
  if (id === 'coordinator') {
    const primary = candidates.find((p) => p.role === 'coordinator');
    if (primary) return primary;
  }
  const exact = candidates.find((p) => p.id === id);
  if (exact) return exact;
  if (legacyRoleIds.includes(id)) {
    const legacy =
      candidates.find((p) => p.role === id) ||
      candidates.find((p) => p.id === `starter-${id}` || p.id === `default-${id}`);
    if (legacy) return legacy;
  }
  return { id, name: 'Agent', role: 'agent', purpose: '', color: '#59616c', shape: 'orbit' };
}
export function validProfile(p: Persona) {
  return (
    p &&
    typeof p.id === 'string' &&
    /^[A-Za-z0-9_-]{1,64}$/.test(p.id) &&
    ['coordinator', 'agent', 'scout', 'maker', 'checker'].includes(p.role) &&
    typeof p.name === 'string' &&
    p.name.trim().length > 0 &&
    p.name.length <= 40 &&
    typeof p.purpose === 'string' &&
    p.purpose.trim().length > 0 &&
    p.purpose.length <= 600 &&
    /^#[0-9a-f]{6}$/i.test(p.color) &&
    shapes.includes(p.shape)
  );
}
export function loadLibrary(): Library {
  try {
    const saved = JSON.parse(localStorage.getItem('tinkerfleet.personas.v1') ?? 'null');
    if (
      saved &&
      Array.isArray(saved.profiles) &&
      saved.profiles.every(validProfile) &&
      new Set(saved.profiles.map((p: Persona) => p.id)).size === saved.profiles.length
    )
      return {
        profiles: saved.profiles,
        assignments:
          saved.assignments && typeof saved.assignments === 'object' ? saved.assignments : {},
      };
  } catch {}
  let profiles = starterProfiles.map((p) => ({ ...p }));
  try {
    const old = JSON.parse(localStorage.getItem('tinkerfleet.team') ?? 'null');
    if (Array.isArray(old))
      profiles = profiles.map((p) => {
        const prior = old.find((a) => a.id === p.id.replace('starter-', ''));
        return prior
          ? {
              ...p,
              name:
                typeof prior.name === 'string' && prior.name.trim()
                  ? prior.name.slice(0, 40)
                  : p.name,
              color: /^#[0-9a-f]{6}$/i.test(prior.color) ? prior.color : p.color,
              shape: shapes.includes(prior.shape) ? prior.shape : p.shape,
            }
          : p;
      });
  } catch {}
  return {
    profiles,
    assignments: Object.fromEntries(profiles.map((p) => [p.role, p.id])) as Record<string, string>,
  };
}
export function character(p: Persona): Person {
  return { ...p, role: agentLabel(p), description: p.purpose };
}
