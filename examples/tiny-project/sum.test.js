import assert from 'node:assert/strict';
import test from 'node:test';
import { sum } from './sum.js';

test('adds two positive numbers', () => assert.equal(sum(2, 3), 5));
test('adds a negative number', () => assert.equal(sum(4, -2), 2));
test('handles zero', () => assert.equal(sum(7, 0), 7));
