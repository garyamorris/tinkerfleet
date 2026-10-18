/**
 * Capabilities: which groups of tools a bot's profile asks for.
 *
 * Two switches decide what an agent actually gets. The server's settings say which tools exist at
 * all (TINKERFLEET_WEB_SEARCH, TINKERFLEET_WORKSPACE_TOOLS). A profile then picks a subset. A
 * profile can only narrow what the server enables, never widen it.
 */
import type { Capability, Persona } from './types.js';

/** Every group, in the order the app stores and shows them. */
export const CAPABILITIES: readonly Capability[] = ['web', 'read', 'edit', 'run', 'memory'];

export const capabilityInfo: Record<Capability, { label: string; tools: string; about: string }> = {
  web: {
    label: 'Web',
    tools: 'web_search',
    about: 'Search and read public web pages at the provider.',
  },
  read: {
    label: 'Read files',
    tools: 'list_files, read_file',
    about: 'List and read permitted files in the workspace. No approval.',
  },
  edit: {
    label: 'Edit files',
    tools: 'edit_file',
    about: 'Propose whole-file edits. Each one waits for your approval.',
  },
  run: {
    label: 'Run commands',
    tools: 'run_command',
    about: 'Propose installed commands. Each one waits for your approval.',
  },
  memory: {
    label: 'Memory',
    tools: 'recall_memory, remember_memory, forget_memory',
    about: 'Keep this bot’s own notes across its conversations.',
  },
};

/** Which groups the server provides right now. */
export interface ServerCapabilities {
  web: boolean;
  workspace: boolean;
  memory: boolean;
}

export const isCapability = (value: unknown): value is Capability =>
  typeof value === 'string' && (CAPABILITIES as readonly string[]).includes(value);

/** Remove duplicates and store in one order, so equal sets compare equal as JSON. */
export const normalizeCapabilities = (list: readonly Capability[]): Capability[] =>
  CAPABILITIES.filter((c) => list.includes(c));

export function enabledCapabilities(server: ServerCapabilities): Capability[] {
  return CAPABILITIES.filter((c) =>
    c === 'web' ? server.web : c === 'memory' ? server.memory : server.workspace,
  );
}

/** What this bot gets: what its profile asks for, capped by what the server enables. */
export function grantedCapabilities(
  profile: Pick<Persona, 'capabilities'>,
  server: ServerCapabilities,
): Capability[] {
  const enabled = enabledCapabilities(server);
  // A profile saved before capabilities existed keeps its old behavior: every enabled tool.
  if (profile.capabilities === undefined) return enabled;
  return enabled.filter((c) => profile.capabilities!.includes(c));
}

/**
 * Reading the workspace and using the web, together, can leak files: text planted in a file or a
 * page can ask the model to put workspace content into a search query or URL (see SECURITY.md).
 */
export const canLeakWorkspace = (list: readonly Capability[]): boolean =>
  list.includes('read') && list.includes('web');

/**
 * Bots the primary creates are not reviewed by the user first. They start with what is safe to
 * give unasked; edit, run, and web together with read wait until the user grants them.
 */
export function splitCreatedCapabilities(list: readonly Capability[]): {
  granted: Capability[];
  needsUser: Capability[];
} {
  const asked = normalizeCapabilities(list);
  const needsUser = asked.filter(
    (c) => c === 'edit' || c === 'run' || (c === 'web' && asked.includes('read')),
  );
  return { granted: asked.filter((c) => !needsUser.includes(c)), needsUser };
}

/**
 * A conversation keeps the copy of each profile it started with, so its name and purpose stay as
 * they were. Capabilities are different: the library's current choice always applies, so granting
 * or removing one takes effect in existing conversations too. A bot deleted from the library keeps
 * the capabilities it was captured with.
 */
export function withLibraryCapabilities(profile: Persona, library: readonly Persona[]): Persona {
  const current = library.find((p) => p.id === profile.id);
  if (!current) return profile;
  const { capabilities: _captured, ...rest } = profile;
  return current.capabilities === undefined
    ? rest
    : { ...rest, capabilities: current.capabilities };
}
