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

test('timer flush errors go to onError, sync and async', async () => {
  const errors = [];
  const onError = (err, batch) => errors.push([err.message, batch]);
  const syncCase = setup({
    onError,
    flush: () => {
      throw new Error('sync');
    },
  });
  syncCase.b.add(1);
  syncCase.timers[0].fn();
  assert.equal(syncCase.b.size, 0);
  const asyncCase = setup({
    onError,
    flush: async () => {
      throw new Error('async');
    },
  });
  asyncCase.b.add(2);
  asyncCase.timers[0].fn();
  await new Promise((r) => setImmediate(r));
  assert.equal(asyncCase.b.size, 0);
  assert.deepEqual(errors, [
    ['sync', [1]],
    ['async', [2]],
  ]);
});

test('timer flush errors without onError do not become unhandled rejections', async () => {
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  const { b, timers } = setup({ flush: async () => Promise.reject(new Error('x')) });
  b.add(1);
  timers[0].fn();
  await new Promise((r) => setImmediate(r));
  process.off('unhandledRejection', onUnhandled);
  assert.deepEqual(unhandled, []);
});

test('add and manual flush propagate flush errors and drop the batch', () => {
  const boom = () => {
    throw new Error('boom');
  };
  const sized = setup({ maxSize: 1, flush: boom });
  assert.throws(() => sized.b.add(1), /boom/);
  assert.equal(sized.b.size, 0);
  const manual = setup({ flush: boom });
  manual.b.add(1);
  assert.throws(() => manual.b.flush(), /boom/);
  assert.equal(manual.b.size, 0);
});

test('maxWaitMs of 0 schedules a zero-delay timer', () => {
  const { b, batches, timers } = setup({ maxWaitMs: 0 });
  b.add(1);
  assert.equal(timers[0].ms, 0);
  timers[0].fn();
  assert.deepEqual(batches, [[1]]);
});

test('a size flush followed by add starts a fresh timer', () => {
  const { b, timers } = setup({ maxSize: 2 });
  b.add(1);
  b.add(2);
  b.add(3);
  assert.equal(timers.length, 2);
  assert.equal(timers[1].cancelled, false);
});

test('default timer flushes after maxWaitMs', async () => {
  const batches = [];
  const b = createBatcher({ maxSize: 5, maxWaitMs: 5, flush: (x) => batches.push(x) });
  b.add(1);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(batches, [[1]]);
  for (const n of [2, 3, 4, 5, 6]) b.add(n);
  assert.deepEqual(batches, [[1], [2, 3, 4, 5, 6]]);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(batches.length, 2);
});

test('validates options', () => {
  assert.throws(() => createBatcher({ maxSize: 0, maxWaitMs: 1, flush() {} }), RangeError);
  assert.throws(() => createBatcher({ maxSize: 1, maxWaitMs: -1, flush() {} }), RangeError);
  assert.throws(() => createBatcher({ maxSize: 1, maxWaitMs: 1 }), TypeError);
  assert.throws(
    () => createBatcher({ maxSize: 1, maxWaitMs: 1, flush() {}, onError: 1 }),
    TypeError,
  );
});
