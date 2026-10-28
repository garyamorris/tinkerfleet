import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { MemoryEntry } from '../shared/types.js';
import { validateText } from './runner-policy.js';

export const MEMORY_LIMITS = Object.freeze({
  entriesPerAgent: 20,
  entryChars: 2_000,
  charsPerAgent: 8_000,
  agents: 100,
  entries: 2_000,
  bytes: 4 * 1024 * 1024,
});
export class MemoryError extends Error {
  constructor(
    public readonly code:
      'INVALID_MEMORY' | 'SECRET_CONTENT' | 'CAPACITY' | 'READ_FAILED' | 'WRITE_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'MemoryError';
  }
}
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const entrySchema = z
  .object({
    id: identifier,
    agentId: identifier,
    text: z.string(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();
const envelopeSchema = z
  .object({ version: z.literal(1), entries: z.array(entrySchema).max(MEMORY_LIMITS.entries) })
  .strict();
function validId(value: unknown): asserts value is string {
  if (!identifier.safeParse(value).success)
    throw new MemoryError('INVALID_MEMORY', 'Choose a valid agent or memory ID.');
}
function normalizedText(value: unknown): string {
  if (typeof value !== 'string')
    throw new MemoryError(
      'INVALID_MEMORY',
      'Memory must be nonempty text of up to 2,000 characters.',
    );
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (
    !text ||
    text.length > MEMORY_LIMITS.entryChars ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ||
    Buffer.from(text).toString('utf8') !== text
  )
    throw new MemoryError(
      'INVALID_MEMORY',
      'Memory must be nonempty text of up to 2,000 characters without control characters.',
    );
  try {
    validateText(text);
  } catch {
    throw new MemoryError('SECRET_CONTENT', 'Memory cannot contain credentials or secrets.');
  }
  return text;
}
function validateEntries(input: unknown): MemoryEntry[] {
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success)
    throw new MemoryError('INVALID_MEMORY', 'Saved memory has an invalid format.');
  const ids = new Set<string>(),
    agents = new Map<string, { count: number; chars: number; texts: Set<string> }>();
  for (const entry of parsed.data.entries) {
    if (
      ids.has(entry.id) ||
      entry.updatedAt < entry.createdAt ||
      normalizedText(entry.text) !== entry.text
    )
      throw new MemoryError('INVALID_MEMORY', 'Saved memory has invalid or duplicate entries.');
    ids.add(entry.id);
    const totals = agents.get(entry.agentId) ?? { count: 0, chars: 0, texts: new Set<string>() };
    if (totals.texts.has(entry.text))
      throw new MemoryError('INVALID_MEMORY', 'Saved memory has invalid or duplicate entries.');
    totals.count++;
    totals.chars += entry.text.length;
    totals.texts.add(entry.text);
    agents.set(entry.agentId, totals);
    if (totals.count > MEMORY_LIMITS.entriesPerAgent || totals.chars > MEMORY_LIMITS.charsPerAgent)
      throw new MemoryError(
        'CAPACITY',
        'An agent can remember up to 20 entries and 8,000 characters. Forget an entry before adding more.',
      );
  }
  if (agents.size > MEMORY_LIMITS.agents)
    throw new MemoryError(
      'CAPACITY',
      'The memory store is full. Forget unused memories before adding more.',
    );
  return parsed.data.entries;
}
function regularPrivateTarget(file: string) {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1))
    throw new Error('Invalid memory target.');
}
function directoryCheck(directory: string) {
  const stat = lstatSync(directory, { throwIfNoEntry: false });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
    throw new Error('Invalid memory directory.');
}

/** Separate private storage; returned entries never expose mutable internal state. */
export class MemoryStore {
  private entries: MemoryEntry[] = [];
  constructor(private readonly statePath?: string) {
    if (!statePath) return;
    try {
      directoryCheck(path.dirname(statePath));
      regularPrivateTarget(statePath);
      if (!lstatSync(statePath, { throwIfNoEntry: false })) return;
      const fd = openSync(
        statePath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > MEMORY_LIMITS.bytes)
          throw new Error('Invalid memory file.');
        this.entries = validateEntries(JSON.parse(readFileSync(fd, 'utf8')));
      } finally {
        closeSync(fd);
      }
    } catch {
      throw new MemoryError(
        'READ_FAILED',
        'Agent memory could not be read safely. The saved file was left unchanged; restore or repair it before starting.',
      );
    }
  }
  list(agentId?: string): MemoryEntry[] {
    if (agentId !== undefined) validId(agentId);
    return this.entries
      .filter((entry) => agentId === undefined || entry.agentId === agentId)
      .map((entry) => ({ ...entry }));
  }
  remember(agentId: string, text: string): MemoryEntry {
    validId(agentId);
    const normalized = normalizedText(text);
    const existing = this.entries.find(
      (entry) => entry.agentId === agentId && entry.text === normalized,
    );
    if (existing) return { ...existing };
    const now = Date.now(),
      entry: MemoryEntry = {
        id: randomUUID(),
        agentId,
        text: normalized,
        createdAt: now,
        updatedAt: now,
      };
    this.commit([...this.entries, entry]);
    return { ...entry };
  }
  forget(agentId: string, id: string): boolean {
    validId(agentId);
    validId(id);
    const next = this.entries.filter((entry) => entry.agentId !== agentId || entry.id !== id);
    if (next.length === this.entries.length) return false;
    this.commit(next);
    return true;
  }
  /** Remove every note one bot saved, when that bot is deleted. */
  forgetAgent(agentId: string): void {
    validId(agentId);
    const next = this.entries.filter((entry) => entry.agentId !== agentId);
    if (next.length !== this.entries.length) this.commit(next);
  }
  private commit(next: MemoryEntry[]): void {
    if (next.length > MEMORY_LIMITS.entries)
      throw new MemoryError(
        'CAPACITY',
        'The memory store is full. Forget unused memories before adding more.',
      );
    const validated = validateEntries({ version: 1, entries: next }),
      serialized = JSON.stringify({ version: 1, entries: validated });
    if (Buffer.byteLength(serialized) > MEMORY_LIMITS.bytes)
      throw new MemoryError(
        'CAPACITY',
        'The memory store is full. Forget unused memories before adding more.',
      );
    if (this.statePath) {
      const directory = path.dirname(this.statePath),
        temporary = path.join(directory, `.memory-${randomUUID()}.tmp`);
      let fd: number | undefined;
      try {
        directoryCheck(directory);
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        directoryCheck(directory);
        regularPrivateTarget(this.statePath);
        fd = openSync(
          temporary,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        writeFileSync(fd, serialized);
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        regularPrivateTarget(this.statePath);
        renameSync(temporary, this.statePath);
      } catch {
        throw new MemoryError(
          'WRITE_FAILED',
          'Agent memory could not be saved. Existing memories were left unchanged. Check local storage before trying again.',
        );
      } finally {
        if (fd !== undefined)
          try {
            closeSync(fd);
          } catch {}
        try {
          unlinkSync(temporary);
        } catch {}
      }
    }
    this.entries = validated;
  }
}
