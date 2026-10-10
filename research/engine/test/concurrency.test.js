import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from '../src/index.js';

test('acquire is bounded by the limit', () => {
  const l = createLimiter({ min: 1, max: 10, start: 2 });
  assert.equal(l.acquire(), true);
  assert.equal(l.acquire(), true);
  assert.equal(l.acquire(), false);
  assert.equal(l.inFlight, 2);
  l.release(true, 10);
  assert.equal(l.acquire(), true);
});

test('additive increase: one step per limit successes, capped at max', () => {
  const l = createLimiter({ min: 1, max: 3, start: 1 });
  l.acquire(); l.release(true, 10);
  assert.equal(l.limit, 2);
  for (let i = 0; i < 2; i++) { l.acquire(); l.release(true, 10); }
  assert.equal(l.limit, 3);
  for (let i = 0; i < 10; i++) { l.acquire(); l.release(true, 10); }
  assert.equal(l.limit, 3);
});

test('multiplicative decrease on failure, floored at min', () => {
  const l = createLimiter({ min: 2, max: 100, start: 40 });
  l.acquire(); l.release(false);
  assert.equal(l.limit, 20);
  for (let i = 0; i < 10; i++) { l.acquire(); l.release(false); }
  assert.equal(l.limit, 2);
});

test('latency spike decreases the limit', () => {
  const l = createLimiter({ min: 1, max: 100, start: 8 });
  l.acquire(); l.release(true, 100);
  l.acquire(); l.release(true, 1000);
  assert.equal(l.limit, 4);
});

test('latency measured with injected clock', () => {
  let t = 0;
  const l = createLimiter({ min: 1, max: 100, start: 8, now: () => t });
  l.acquire(); t += 10; l.release(true);
  l.acquire(); t += 500; l.release(true);
  assert.equal(l.limit, 4);
});

test('release without acquire throws; bad options throw', () => {
  assert.throws(() => createLimiter({ min: 1, max: 2 }).release(true), Error);
  assert.throws(() => createLimiter({ min: 0, max: 2 }), RangeError);
  assert.throws(() => createLimiter({ min: 1, max: 2, start: 5 }), RangeError);
});
