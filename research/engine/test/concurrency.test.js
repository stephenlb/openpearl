import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from '../src/index.js';

test('acquire is bounded by the limit', () => {
  const l = createLimiter({ min: 1, max: 10, start: 2 });
  assert.ok(l.acquire());
  assert.ok(l.acquire());
  assert.equal(l.acquire(), false);
  assert.equal(l.inFlight, 2);
  l.release(true, 10);
  assert.ok(l.acquire());
});

test('release uses the token of the finished request', () => {
  let t = 0;
  const l = createLimiter({ min: 1, max: 100, start: 8, now: () => t });
  const slow = l.acquire();
  t += 1000;
  const fast = l.acquire();
  t += 10;
  l.release(true, undefined, fast);
  assert.equal(l.limit, 8);
  l.release(true, undefined, slow);
});

test('a sustained latency shift is absorbed and growth resumes', () => {
  const l = createLimiter({ min: 1, max: 100, start: 4 });
  l.acquire(); l.release(true, 100);
  for (let i = 0; i < 100; i++) { l.acquire(); l.release(true, 400); }
  assert.ok(l.limit > 2);
});

test('a burst of simultaneous failures decreases once', () => {
  const l = createLimiter({ min: 1, max: 100, start: 8 });
  const ts = [];
  for (let i = 0; i < 4; i++) ts.push(l.acquire());
  for (const t of ts) l.release(false, undefined, t);
  assert.equal(l.limit, 4);
});

test('invalid latency throws', () => {
  const l = createLimiter({ min: 1, max: 4 });
  l.acquire();
  assert.throws(() => l.release(true, NaN), RangeError);
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
