import test from 'node:test';
import assert from 'node:assert/strict';
import { containsSecret, redactSdkText } from '../src/server/safety.js';

test('one credential list covers chat text, command output and file checks alike', () => {
  const samples = [
    'sk-proj-abcdefghijklmnopqrstuvwxyz',
    'ghp_abcdefghijklmnop',
    'gho_abcdefghijklmnop',
    'ghs_abcdefghijklmnop',
    'github_pat_abcdefghijklmnop',
    'AKIAABCDEFGHIJKLMNOP',
    'Authorization: Bearer abc.def.ghi',
    'api_key = "abcdefghijklmnop"',
    'password: hunter2hunter2',
    '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----',
    '-----BEGIN PRIVATE KEY-----\ntruncated output with no end marker',
  ];
  for (const sample of samples) {
    assert.equal(containsSecret(`before ${sample} after`), true, sample);
    assert.doesNotMatch(redactSdkText(sample), /abcdefghijklmnop|hunter2|truncated output/, sample);
  }
  for (const ordinary of ['export const sum = (a, b) => a + b;', 'ask-me later', 'skip-this'])
    assert.equal(containsSecret(ordinary), false, ordinary);
});
