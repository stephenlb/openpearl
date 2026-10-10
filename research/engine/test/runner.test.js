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
