import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimeoutEstimator } from '../src/adaptive-timeout.js';

test('returns max before any observation', () => {
  assert.equal(createTimeoutEstimator({ min: 10, max: 5000 }).current(), 5000);
});

test('percentile times multiplier', () => {
  const e = createTimeoutEstimator({ min: 1, max: 100000, percentile: 0.5, multiplier: 2 });
  [100, 200, 300].forEach((v) => e.observe(v));
  assert.equal(e.current(), 400);
});

test('default p95 and 1.5x', () => {
  const e = createTimeoutEstimator({ min: 1, max: 100000 });
  for (let i = 1; i <= 100; i++) e.observe(i * 10);
  assert.equal(e.current(), 950 * 1.5);
});

test('clamps to min and max', () => {
  const e = createTimeoutEstimator({ min: 500, max: 1000 });
  e.observe(10);
  assert.equal(e.current(), 500);
  e.observe(100000);
  assert.equal(e.current(), 1000);
});

test('rolling window drops old samples', () => {
  const e = createTimeoutEstimator({ min: 1, max: 100000, window: 3, multiplier: 1 });
  e.observe(5000);
  [10, 20, 30].forEach((v) => e.observe(v));
  assert.equal(e.current(), 30);
});

test('validates input', () => {
  assert.throws(() => createTimeoutEstimator({ min: 10, max: 5 }), RangeError);
  assert.throws(() => createTimeoutEstimator({ min: 1, max: 5, percentile: 0 }), RangeError);
  assert.throws(() => createTimeoutEstimator({ min: 1, max: 5 }).observe(-1), RangeError);
});
