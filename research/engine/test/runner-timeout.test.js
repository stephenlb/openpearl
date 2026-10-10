import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTask } from '../src/index.js';

test('timeoutMs: timed-out attempt is retried and then succeeds', async () => {
  const timers = [];
  const setTimer = (cb, ms) => { timers.push({ cb, ms }); return timers.length - 1; };
  const seen = [];
  const promise = runTask(
    (n) => (n === 1 ? new Promise(() => {}) : 'ok'),
    { timeoutMs: 50, setTimer, clearTimer: () => {}, onAttempt: (a) => seen.push([a.attempt, a.ok, a.error?.name]) },
  );
  await new Promise((r) => setImmediate(r));
  timers[0].cb();
  const res = await promise;
  assert.deepEqual(res, { ok: true, value: 'ok', attempts: 2 });
  assert.equal(timers[0].ms, 50);
  assert.deepEqual(seen, [[1, false, 'TimeoutError'], [2, true, undefined]]);
});

test('timeoutMs: exhausted retries return TimeoutError', async () => {
  const setTimer = (cb) => { queueMicrotask(cb); return 0; };
  const res = await runTask(() => new Promise(() => {}), { timeoutMs: 5, retries: 2, setTimer, clearTimer: () => {} });
  assert.equal(res.ok, false);
  assert.equal(res.attempts, 3);
  assert.equal(res.error.name, 'TimeoutError');
});

test('timeoutMs: fast task is unaffected', async () => {
  const res = await runTask(() => 7, { timeoutMs: 1000 });
  assert.deepEqual(res, { ok: true, value: 7, attempts: 1 });
});

test('timeoutMs: invalid values disable the timeout', async () => {
  for (const timeoutMs of [0, -5, NaN]) {
    let armed = 0;
    const res = await runTask(() => 'v', { timeoutMs, setTimer: () => { armed++; return 0; }, clearTimer: () => {} });
    assert.deepEqual(res, { ok: true, value: 'v', attempts: 1 });
    assert.equal(armed, 0);
  }
});

test('timeoutMs: permanent error stops without retry', async () => {
  const err = new Error('open');
  err.name = 'BreakerOpenError';
  const res = await runTask(() => { throw err; }, { timeoutMs: 1000, retries: 3 });
  assert.equal(res.ok, false);
  assert.equal(res.attempts, 1);
  assert.equal(res.error, err);
});

test('timeoutMs: timer is cleared after a fast success', async () => {
  const cleared = [];
  const res = await runTask(() => 1, { timeoutMs: 50, setTimer: () => 42, clearTimer: (h) => cleared.push(h) });
  assert.equal(res.ok, true);
  assert.deepEqual(cleared, [42]);
});
