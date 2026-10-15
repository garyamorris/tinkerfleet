import { createHash, randomUUID } from 'node:crypto';

/** An approval is a session-local, single-use capability, never a durable permission. */
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'consumed' | 'expired';
export interface ApprovalRecord<T = unknown> {
  readonly id: string;
  readonly runId: string;
  readonly digest: string;
  readonly action: T;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly status: ApprovalStatus;
}
export class ApprovalError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ApprovalError';
  }
}

/** Canonical JSON deliberately rejects ambiguous/non-JSON inputs and object tricks. */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  function visit(input: unknown, depth: number): string {
    if (depth > 32) throw new ApprovalError('INVALID_ACTION', 'Action is too deeply nested.');
    if (input === null) return 'null';
    if (typeof input === 'string' || typeof input === 'boolean') return JSON.stringify(input);
    if (typeof input === 'number' && Number.isFinite(input)) return JSON.stringify(input);
    if (typeof input !== 'object') throw new ApprovalError('INVALID_ACTION', 'Actions must contain only JSON values.');
    if (seen.has(input)) throw new ApprovalError('INVALID_ACTION', 'Cyclic actions are not supported.');
    const prototype = Object.getPrototypeOf(input);
    if (!Array.isArray(input) && prototype !== Object.prototype && prototype !== null) {
      throw new ApprovalError('INVALID_ACTION', 'Actions must use plain JSON objects.');
    }
    if (Object.getOwnPropertySymbols(input).length) throw new ApprovalError('INVALID_ACTION', 'Action symbol properties are not supported.');
    seen.add(input);
    let result: string;
    if (Array.isArray(input)) {
      if (Object.keys(input).length !== input.length) throw new ApprovalError('INVALID_ACTION', 'Sparse or decorated arrays are not supported.');
      const items: string[] = [];
      for (let index = 0; index < input.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(input, index);
        if (!descriptor || !('value' in descriptor)) throw new ApprovalError('INVALID_ACTION', 'Sparse arrays and action accessors are not supported.');
        items.push(visit(descriptor.value, depth + 1));
      }
      result = '[' + items.join(',') + ']';
    } else {
      result = '{' + Object.keys(input).sort().map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
        if (!('value' in descriptor)) throw new ApprovalError('INVALID_ACTION', 'Action accessors are not supported.');
        return JSON.stringify(key) + ':' + visit(descriptor.value, depth + 1);
      }).join(',') + '}';
    }
    seen.delete(input);
    return result;
  }
  return visit(value, 0);
}
function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}
export function actionDigest(runId: string, action: unknown): string {
  return createHash('sha256').update(canonicalJson({ runId, action })).digest('hex');
}

export class ApprovalStore {
  readonly #records = new Map<string, ApprovalRecord>();
  readonly #now: () => number;
  constructor(options: { now?: () => number; defaultTtlMs?: number; maxRecords?: number } = {}) {
    this.#now = options.now ?? Date.now;
    this.defaultTtlMs = options.defaultTtlMs ?? 5 * 60_000;
    this.maxRecords = options.maxRecords ?? 2_048;
  }
  private readonly defaultTtlMs: number;
  private readonly maxRecords: number;

  request<T>(runId: string, action: T, ttlMs = this.defaultTtlMs): ApprovalRecord<T> {
    if (typeof runId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(runId)) throw new ApprovalError('INVALID_RUN', 'Invalid run ID.');
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 30 * 60_000) {
      throw new ApprovalError('INVALID_TTL', 'Approval lifetime must be between 1 ms and 30 minutes.');
    }
    if (this.#records.size >= this.maxRecords) {
      for (const [id] of this.#records) {
        const status = this.get(id)?.status;
        if (status === 'consumed' || status === 'denied' || status === 'expired') this.#records.delete(id);
      }
    }
    if (this.#records.size >= this.maxRecords) throw new ApprovalError('CAPACITY', 'Too many outstanding approvals.');
    const serialized = canonicalJson(action);
    if (Buffer.byteLength(serialized) > 512 * 1024) throw new ApprovalError('INVALID_ACTION', 'Action is too large.');
    const immutableAction = freezeDeep(JSON.parse(serialized)) as T;
    const now = this.#now();
    const record: ApprovalRecord<T> = Object.freeze({
      id: randomUUID(), runId, digest: actionDigest(runId, immutableAction), action: immutableAction,
      createdAt: now, expiresAt: now + ttlMs, status: 'pending',
    });
    this.#records.set(record.id, record);
    return record;
  }
  get(id: string): ApprovalRecord | undefined {
    const record = this.#records.get(id);
    if (record && (record.status === 'pending' || record.status === 'approved') && this.#now() >= record.expiresAt) {
      return this.replace(record, 'expired');
    }
    return record;
  }
  approve(id: string): ApprovalRecord {
    const record = this.require(id);
    if (record.status !== 'pending') throw new ApprovalError('NOT_PENDING', `Approval is ${record.status}.`);
    return this.replace(record, 'approved');
  }
  decide(runId: string, id: string, digest: string, approved: boolean): ApprovalRecord {
    if (typeof approved !== 'boolean') throw new ApprovalError('INVALID_DECISION', 'Approval decisions must be explicit booleans.');
    const record = this.require(id);
    if (record.runId !== runId || record.digest !== digest) {
      throw new ApprovalError('ACTION_MISMATCH', 'Approval decision does not match this run and digest.');
    }
    return approved ? this.approve(id) : this.deny(id);
  }
  deny(id: string): ApprovalRecord {
    const record = this.require(id);
    if (record.status !== 'pending' && record.status !== 'approved') {
      throw new ApprovalError('NOT_PENDING', `Approval is ${record.status}.`);
    }
    return this.replace(record, 'denied');
  }
  /** Synchronous state transition occurs before the caller can start asynchronous work. */
  consume(id: string, runId: string, action: unknown): ApprovalRecord {
    const record = this.require(id);
    if (record.status !== 'approved') throw new ApprovalError('NOT_APPROVED', `Approval is ${record.status}.`);
    if (record.runId !== runId || record.digest !== actionDigest(runId, action)) {
      throw new ApprovalError('ACTION_MISMATCH', 'Approval does not match this exact run and action.');
    }
    return this.replace(record, 'consumed');
  }
  invalidateRun(runId: string): void {
    for (const [id] of this.#records) {
      const record = this.get(id)!;
      if (record.runId === runId && (record.status === 'pending' || record.status === 'approved')) this.deny(id);
    }
  }
  clear(): void { this.#records.clear(); }
  private require(id: string): ApprovalRecord {
    const record = this.get(id);
    if (!record) throw new ApprovalError('UNKNOWN_APPROVAL', 'Unknown approval; approvals do not survive a process restart.');
    return record;
  }
  private replace(record: ApprovalRecord, status: ApprovalStatus): ApprovalRecord {
    const updated = Object.freeze({ ...record, status });
    this.#records.set(record.id, updated);
    return updated;
  }
}
