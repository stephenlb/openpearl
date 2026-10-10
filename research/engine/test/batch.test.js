import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBatcher } from '../src/index.js';

function setup(opts = {}) {
  const batches = [];
  const timers = [];
  const setTimer = (fn, ms) => {
    const t = { fn, ms, cancelled: false };
    timers.push(t);
    return () => {
      t.cancelled = true;
    };
  };
  const b = createBatcher({
    maxSize: 3,
    maxWaitMs: 50,
    flush: (batch) => batches.push(batch),
    setTimer,
    ...opts,
  });
  return { b, batches, timers };
}

test('flushes when maxSize is reached and cancels the timer', () => {
  const { b, batches, timers } = setup();
  b.add(1);
  b.add(2);
  assert.equal(b.size, 2);
  b.add(3);
  assert.deepEqual(batches, [[1, 2, 3]]);
  assert.equal(b.size, 0);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].cancelled, true);
});

test('flushes on timer, started by the first item', () => {
  const { b, batches, timers } = setup();
  b.add('a');
  b.add('b');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 50);
  timers[0].fn();
  assert.deepEqual(batches, [['a', 'b']]);
  assert.equal(b.size, 0);
});

test('a new timer starts for the next batch', () => {
  const { b, batches, timers } = setup();
  b.add(1);
  timers[0].fn();
  b.add(2);
  assert.equal(timers.length, 2);
  timers[1].fn();
  assert.deepEqual(batches, [[1], [2]]);
});

test('manual flush drains and ignores an empty queue', () => {
  const { b, batches, timers } = setup();
  b.flush();
  assert.deepEqual(batches, []);
  b.add(1);
  b.flush();
  assert.deepEqual(batches, [[1]]);
  assert.equal(timers[0].cancelled, true);
});

test('add returns the flush result on size flush', () => {
  const { b } = setup({ maxSize: 1, flush: (x) => x.length });
  assert.equal(b.add('x'), 1);
});

test('timer flush errors are swallowed, sync and async', async () => {
  const sync = setup({
    flush: () => {
      throw new Error('boom');
    },
  });
  sync.b.add(1);
  sync.timers[0].fn();
  assert.equal(sync.b.size, 0);
  const async = setup({
    flush: async () => {
      throw new Error('boom');
    },
  });
  async.b.add(1);
  async.timers[0].fn();
  await new Promise((r) => setImmediate(r));
});

test('validates options', () => {
  assert.throws(() => createBatcher({ maxSize: 0, maxWaitMs: 1, flush() {} }), RangeError);
  assert.throws(() => createBatcher({ maxSize: 1, maxWaitMs: -1, flush() {} }), RangeError);
  assert.throws(() => createBatcher({ maxSize: 1, maxWaitMs: 1 }), TypeError);
});
