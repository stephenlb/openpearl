import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDLQ } from '../src/index.js';

test('push and list preserve order', () => {
  const q = createDLQ({ max: 3 });
  q.push('a', new Error('x'));
  q.push('b', 'y');
  assert.deepEqual(q.list().map((e) => e.job), ['a', 'b']);
  assert.equal(q.list()[1].err, 'y');
  assert.equal(q.size, 2);
});

test('evicts oldest when full', () => {
  const q = createDLQ({ max: 2 });
  q.push(1, 'e'); q.push(2, 'e'); q.push(3, 'e');
  assert.deepEqual(q.list().map((e) => e.job), [2, 3]);
  assert.equal(q.evicted, 1);
});

test('replay removes successes and keeps failures', async () => {
  const q = createDLQ({ max: 5 });
  [1, 2, 3, 4].forEach((j) => q.push(j, 'e'));
  const seen = [];
  const res = await q.replay(async (job) => {
    seen.push(job);
    if (job % 2 === 0) throw new Error('still bad');
  });
  assert.deepEqual(seen, [1, 2, 3, 4]);
  assert.deepEqual(res, { replayed: 2, failed: 2, remaining: 2 });
  assert.deepEqual(q.list().map((e) => e.job), [2, 4]);
  assert.equal(q.list()[0].err.message, 'still bad');
});

test('replay on empty queue and bad args', async () => {
  const q = createDLQ();
  assert.deepEqual(await q.replay(() => {}), { replayed: 0, failed: 0, remaining: 0 });
  await assert.rejects(() => q.replay(null), TypeError);
  assert.throws(() => createDLQ({ max: 0 }), RangeError);
});

test('entries pushed during replay are kept for later', async () => {
  const q = createDLQ({ max: 5 });
  q.push('a', 'e');
  await q.replay(() => { q.push('new', 'e'); });
  assert.deepEqual(q.list().map((e) => e.job), ['new']);
});
