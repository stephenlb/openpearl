import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelay } from '../src/index.js';

const mid = () => 0.5; // zero jitter offset

test('grows exponentially', () => {
  assert.deepEqual([0, 1, 2, 3].map((a) => backoffDelay(a, { rng: mid })), [100, 200, 400, 800]);
});

test('respects custom base and factor', () => {
  assert.equal(backoffDelay(2, { baseMs: 10, factor: 3, rng: mid }), 90);
});

test('caps at maxMs', () => {
  assert.equal(backoffDelay(20, { rng: mid }), 10000);
  assert.equal(backoffDelay(20, { rng: () => 0.999 }), 10000);
});

test('jitter stays within bounds', () => {
  assert.equal(backoffDelay(1, { rng: () => 0 }), 160);
  assert.equal(backoffDelay(1, { rng: () => 1 }), 240);
  assert.equal(backoffDelay(1, { jitter: 0, rng: () => 0.9 }), 200);
});

test('deterministic with injected rng', () => {
  const rng = () => 0.25;
  assert.equal(backoffDelay(3, { rng }), backoffDelay(3, { rng }));
});
