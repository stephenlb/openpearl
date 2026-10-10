import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout, TimeoutError } from '../src/index.js';

function fakeTimers() {
  const timers = new Map();
  let nextId = 1;
  return {
    timers,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    fire: () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } },
  };
}

test('resolves with the value and clears the timer', async () => {
  const f = fakeTimers();
  const result = await withTimeout(async () => 'ok', 50, f);
  assert.equal(result, 'ok');
  assert.equal(f.timers.size, 0);
});

test('passes the requested delay to setTimer', () => {
  const f = fakeTimers();
  withTimeout(() => new Promise(() => {}), 123, f);
  assert.equal([...f.timers.values()][0].ms, 123);
});

test('rejects with TimeoutError when the timer fires first', async () => {
  const f = fakeTimers();
  const p = withTimeout(() => new Promise(() => {}), 50, f);
  f.fire();
  await assert.rejects(p, (err) => err instanceof TimeoutError && err.ms === 50 && err.name === 'TimeoutError');
});

test('propagates the original rejection and clears the timer', async () => {
  const f = fakeTimers();
  await assert.rejects(withTimeout(async () => { throw new Error('boom'); }, 50, f), /boom/);
  assert.equal(f.timers.size, 0);
});

test('handles synchronous throws from promiseFn', async () => {
  const f = fakeTimers();
  await assert.rejects(withTimeout(() => { throw new Error('sync'); }, 50, f), /sync/);
  assert.equal(f.timers.size, 0);
});

test('late settlement after timeout is ignored', async () => {
  const f = fakeTimers();
  let resolveLate;
  const p = withTimeout(() => new Promise((r) => { resolveLate = r; }), 50, f);
  f.fire();
  await assert.rejects(p, TimeoutError);
  resolveLate('late');
});
