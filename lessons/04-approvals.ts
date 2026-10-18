/** Lesson 4: actual approval state transitions, with a fake clock and no I/O. */
import assert from 'node:assert/strict';
import { ApprovalStore, actionDigest, canonicalJson } from '../src/server/approval.js';

let now = 1_000;
const approvals = new ApprovalStore({ now: () => now, defaultTtlMs: 1_000 });
const action = { kind: 'edit', path: 'sum.js', content: 'return a + b;' };
const pending = approvals.request('lesson-run', action);
assert.equal(pending.status, 'pending');
assert.throws(() => approvals.consume(pending.id, 'lesson-run', action));
approvals.approve(pending.id);
assert.throws(() => approvals.consume(pending.id, 'different-run', action));
assert.throws(() =>
  approvals.consume(pending.id, 'lesson-run', { ...action, content: 'changed after review' }),
);
assert.equal(approvals.consume(pending.id, 'lesson-run', action).status, 'consumed');
assert.throws(() => approvals.consume(pending.id, 'lesson-run', action)); // no replay

const denied = approvals.request('denied-run', action);
approvals.deny(denied.id);
assert.throws(() => approvals.consume(denied.id, 'denied-run', action));
const expiring = approvals.request('expiry-run', action);
approvals.approve(expiring.id);
now += 1_000;
assert.equal(approvals.get(expiring.id)?.status, 'expired');
assert.throws(() => approvals.consume(expiring.id, 'expiry-run', action));

// Canonical keys make field order irrelevant, while values and run identity matter.
assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
assert.notEqual(actionDigest('one', action), actionDigest('two', action));
assert.throws(() => canonicalJson({ notJson: undefined }));
const afterRestart = new ApprovalStore();
assert.throws(() => afterRestart.approve(pending.id));

console.log('4. Approvals: pending → approved → consumed, exactly once.');
console.log(
  'Changed actions, different runs, denial, expiry, replay, and restart all fail closed.',
);
console.log('Exercise: invalidate a run with two pending actions and assert neither can execute.');
