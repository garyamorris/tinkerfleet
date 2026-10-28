/**
 * Starter prompts for an empty chat, chosen for the bot you are talking to. In the demo they are
 * the requests the scripted model recognizes for that bot's tools; in live mode, a first step that
 * fits what the bot can use.
 */
import type { Capability, Persona } from '../shared/types';

export function starterPrompts(
  bot: Persona,
  mode: 'demo' | 'live',
  /** What this bot can use now: its profile, capped by the server. */
  granted: readonly Capability[],
  /** The other bots in the library, so the primary can be asked to message one. */
  others: readonly Persona[],
): string[] {
  const can = (c: Capability) => granted.includes(c);
  const prompts: string[] = [];
  if (bot.role === 'coordinator') {
    if (mode === 'demo') {
      prompts.push('Help me fix the failing tests in tiny-project.');
      prompts.push('Create a patient astronomy tutor called Nova.');
      const other = others.find((p) => p.role !== 'coordinator');
      if (other) prompts.push(`Ask ${other.name}: Hello`);
    } else {
      prompts.push('Create a patient Python tutor called Ada.');
      prompts.push('Help me plan a small project, and bring in other bots if that helps.');
      if (can('read')) prompts.push('What is in this project, and where should I start reading?');
    }
    return prompts.slice(0, 3);
  }
  if (mode === 'demo') {
    // The scripted model inspects, fixes or verifies tiny-project when the bot has that tool.
    if (can('read')) prompts.push('Inspect sum.js in tiny-project.');
    if (can('read') && can('edit')) prompts.push('Fix sum.js in tiny-project.');
    if (can('run')) prompts.push('Verify the tests in tiny-project.');
    prompts.push('Hello!');
    return prompts.slice(0, 3);
  }
  if (can('web')) prompts.push('What happened in AI this week? Cite your sources.');
  if (can('read'))
    prompts.push('List the files in this project and explain how they fit together.');
  if (can('run')) prompts.push('Run the project’s tests and tell me what you find.');
  if (can('memory')) prompts.push('Remember that I prefer short answers with one example.');
  prompts.push('Introduce yourself and tell me how you can help.');
  return prompts.slice(0, 3);
}
