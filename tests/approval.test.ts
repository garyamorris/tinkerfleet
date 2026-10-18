import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ApprovalStore,
  ApprovalError,
  actionDigest,
  canonicalJson,
} from '../src/server/approval.js';

const action = () => ({
  kind: 'command',
  executable: 'node',
  args: ['--test'],
  snapshotDigest: 'snapshot-a',
});

test('canonical digest binds run and action, regardless of object key order', () => {
  assert.equal(actionDigest('run-1', { a: 1, b: 2 }), actionDigest('run-1', { b: 2, a: 1 }));
  assert.notEqual(actionDigest('run-1', action()), actionDigest('run-2', action()));
  assert.notEqual(
    actionDigest('run-1', action()),
    actionDigest('run-1', { ...action(), args: ['--version'] }),
  );
  assert.throws(() => canonicalJson({ value: undefined }), ApprovalError);
  assert.throws(() => canonicalJson({ value: Infinity }), ApprovalError);
  assert.throws(() => canonicalJson(new Date()), ApprovalError);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.throws(() => canonicalJson(circular), ApprovalError);
  assert.throws(
    () =>
      canonicalJson({
        get hidden() {
          throw new Error('getter must not run');
        },
      }),
    ApprovalError,
  );
});

test('approval owns an immutable deep clone and exact approved action', () => {
  const store = new ApprovalStore();
  const original = action();
  const record = store.request('run-1', original);
  original.args.push('changed.js');
  assert.deepEqual(record.action.args, ['--test']);
  assert.ok(
    Object.isFrozen(record) &&
      Object.isFrozen(record.action) &&
      Object.isFrozen(record.action.args),
  );
  assert.throws(() => (record.action.args as string[]).push('mutation.js'));
  assert.throws(() => store.consume(record.id, 'run-1', record.action), { code: 'NOT_APPROVED' });
  store.decide('run-1', record.id, record.digest, true);
  assert.throws(() => store.consume(record.id, 'run-1', original), { code: 'ACTION_MISMATCH' });
  assert.equal(store.consume(record.id, 'run-1', record.action).status, 'consumed');
  assert.throws(() => store.consume(record.id, 'run-1', record.action), { code: 'NOT_APPROVED' });
  assert.throws(() => store.approve(record.id), { code: 'NOT_PENDING' });
});

test('wrong run or digest cannot approve or consume', () => {
  const store = new ApprovalStore();
  const record = store.request('run-1', action());
  assert.throws(() => store.decide('run-2', record.id, record.digest, true), {
    code: 'ACTION_MISMATCH',
  });
  assert.throws(() => store.decide('run-1', record.id, 'different', true), {
    code: 'ACTION_MISMATCH',
  });
  store.approve(record.id);
  assert.throws(() => store.consume(record.id, 'run-2', record.action), {
    code: 'ACTION_MISMATCH',
  });
});

test('denial, exact expiry boundary, cancellation, and restart invalidate approvals', () => {
  let now = 1_000;
  const store = new ApprovalStore({ now: () => now, defaultTtlMs: 100 });
  const denied = store.request('run-1', action());
  store.deny(denied.id);
  assert.throws(() => store.approve(denied.id), { code: 'NOT_PENDING' });
  const expired = store.request('run-1', action());
  store.approve(expired.id);
  now = 1_100;
  assert.equal(store.get(expired.id)?.status, 'expired');
  assert.throws(() => store.consume(expired.id, 'run-1', expired.action), { code: 'NOT_APPROVED' });
  const cancelled = store.request('run-1', action());
  store.approve(cancelled.id);
  store.invalidateRun('run-1');
  assert.equal(store.get(cancelled.id)?.status, 'denied');
  assert.throws(() => new ApprovalStore().consume(cancelled.id, 'run-1', cancelled.action), {
    code: 'UNKNOWN_APPROVAL',
  });
});

test('simultaneous consumers have exactly one winner', async () => {
  const store = new ApprovalStore();
  const record = store.request('run-1', action());
  store.approve(record.id);
  const attempts = await Promise.allSettled(
    Array.from({ length: 10 }, async () => store.consume(record.id, 'run-1', record.action)),
  );
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
});

test('bounded store and invalid TTL fail closed', () => {
  const store = new ApprovalStore({ maxRecords: 1 });
  assert.throws(() => store.request('run-1', action(), 0), { code: 'INVALID_TTL' });
  assert.throws(() => store.request('../bad', action()), { code: 'INVALID_RUN' });
  const record = store.request('run-1', action());
  assert.throws(() => store.request('run-2', action()), { code: 'CAPACITY' });
  store.deny(record.id);
  assert.equal(store.request('run-2', action()).status, 'pending');
});
