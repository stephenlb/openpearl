import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDLQ } from '../src/index.js';

test('push and list record job, error and time', () => {
  let t = 10;
  const q = createDLQ({ max: 3, now: () => t++ });
  q.push({ id: 1 }, new TypeError('bad'));
  assert.deepEqual(q.list(), [{ job: { id: 1 }, error: { name: 'TypeError', message: 'bad' }, at: 10 }]);
});

test('evicts oldest when full', () => {
  const q = createDLQ({ max: 2 });
  assert.equal(q.push('a', new Error('x')), 0);
  q.push('b', new Error('x'));
  assert.equal(q.push('c', new Error('x')), 1);
  assert.deepEqual(q.list().map((e) => e.job), ['b', 'c']);
});

test('replay removes successes, keeps failures, returns counts', async () => {
  const q = createDLQ({ max: 5 });
  for (const j of [1, 2, 3]) q.push(j, new Error('x'));
  const seen = [];
  const res = await q.replay(async (job) => {
    seen.push(job);
    if (job === 2) throw new Error('still bad');
  });
  assert.deepEqual(seen, [1, 2, 3]);
  assert.deepEqual(res, { replayed: 2, failed: 1 });
  assert.deepEqual(q.list().map((e) => e.job), [2]);
});

test('jobs pushed during replay are kept and bound is respected', async () => {
  const q = createDLQ({ max: 2 });
  q.push('a', new Error('x'));
  q.push('b', new Error('x'));
  await q.replay((job) => {
    q.push(`re-${job}`, new Error('y'));
    throw new Error('fail');
  });
  assert.deepEqual(q.list().map((e) => e.job), ['re-a', 're-b']);
});

test('validates arguments', async () => {
  assert.throws(() => createDLQ({ max: 0 }), TypeError);
  await assert.rejects(createDLQ().replay(null), TypeError);
});
