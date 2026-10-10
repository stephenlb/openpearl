import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTask } from '../src/index.js';

test('succeeds on first try', async () => {
  const sleeps = [];
  const res = await runTask(() => 42, { sleep: (ms) => sleeps.push(ms), delayMs: 10 });
  assert.deepEqual(res, { ok: true, value: 42, attempts: 1 });
  assert.deepEqual(sleeps, []);
});

test('succeeds after 2 failures', async () => {
  const sleeps = [];
  const seen = [];
  let calls = 0;
  const res = await runTask(
    () => {
      if (++calls < 3) throw new Error(`fail ${calls}`);
      return 'done';
    },
    { delayMs: 5, sleep: (ms) => sleeps.push(ms), onAttempt: (a) => seen.push([a.attempt, a.ok]) },
  );
  assert.deepEqual(res, { ok: true, value: 'done', attempts: 3 });
  assert.deepEqual(sleeps, [5, 5]);
  assert.deepEqual(seen, [[1, false], [2, false], [3, true]]);
});

test('returns last error when retries are exhausted', async () => {
  let calls = 0;
  const res = await runTask(
    () => {
      throw new Error(`fail ${++calls}`);
    },
    { retries: 2, sleep: () => {} },
  );
  assert.equal(res.ok, false);
  assert.equal(res.attempts, 3);
  assert.equal(res.error.message, 'fail 3');
});

test('does not sleep after the final failed attempt', async () => {
  const sleeps = [];
  const res = await runTask(
    () => {
      throw new Error('x');
    },
    { retries: 2, delayMs: 7, sleep: (ms) => sleeps.push(ms) },
  );
  assert.equal(res.attempts, 3);
  assert.deepEqual(sleeps, [7, 7]);
});

test('retries: 0 runs once', async () => {
  let calls = 0;
  const res = await runTask(
    () => {
      calls++;
      throw new Error('x');
    },
    { retries: 0 },
  );
  assert.equal(calls, 1);
  assert.equal(res.ok, false);
  assert.equal(res.attempts, 1);
});

test('handles async rejection and passes attempt number to fn', async () => {
  const args = [];
  const res = await runTask(
    async (n) => {
      args.push(n);
      if (n < 2) throw new Error('nope');
      return 'ok';
    },
    { sleep: () => {} },
  );
  assert.deepEqual(args, [1, 2]);
  assert.deepEqual(res, { ok: true, value: 'ok', attempts: 2 });
});

test('throwing onAttempt does not re-run a succeeded task', async () => {
  let calls = 0;
  const res = await runTask(
    () => {
      calls++;
      return 1;
    },
    {
      onAttempt: () => {
        throw new Error('cb');
      },
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(res, { ok: true, value: 1, attempts: 1 });
});

test('rejecting async onAttempt does not cause an unhandled rejection', async () => {
  const unhandled = [];
  const handler = (e) => unhandled.push(e);
  process.on('unhandledRejection', handler);
  try {
    const res = await runTask(() => 1, { onAttempt: async () => { throw new Error('cb'); } });
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(res, { ok: true, value: 1, attempts: 1 });
    assert.equal(unhandled.length, 0);
  } finally {
    process.off('unhandledRejection', handler);
  }
});

test('invalid retries falls back to default', async () => {
  let calls = 0;
  const res = await runTask(
    () => {
      calls++;
      throw new Error('x');
    },
    { retries: NaN, sleep: () => {} },
  );
  assert.equal(calls, 4);
  assert.equal(res.attempts, 4);
});
