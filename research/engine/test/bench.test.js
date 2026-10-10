import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bench, compareBench } from '../src/bench.js';

// Fake clock: each now() call advances by the next step; fn calls consume 2 ticks (start, end).
function clock(steps) {
  let t = 0n;
  let i = 0;
  let calls = 0;
  return (...a) => {
    calls++;
    // odd calls are "start" (no advance), even calls are "end" (advance by step)
    if (calls % 2 === 0) t += BigInt(steps[i++ % steps.length]);
    return t;
  };
}

test('computes stats from injected clock', () => {
  const r = bench('x', () => {}, { iterations: 4, warmup: 0, now: clock([10, 20, 30, 40]) });
  assert.equal(r.name, 'x');
  assert.equal(r.mean, 25);
  assert.equal(r.stddev, Math.sqrt(125));
  assert.equal(r.p95, 40);
  assert.equal(r.opsPerSec, 1e9 / 25);
});

test('warmup runs fn but is not timed', () => {
  let calls = 0;
  bench('w', () => calls++, { iterations: 3, warmup: 2, now: clock([1]) });
  assert.equal(calls, 5);
});

test('default clock works', () => {
  const r = bench('d', () => {}, { iterations: 5, warmup: 0 });
  assert.equal(r.iterations, 5);
  assert.ok(r.mean >= 0);
});

test('validates arguments', () => {
  assert.throws(() => bench('a', 1), TypeError);
  assert.throws(() => bench('a', () => {}, { iterations: 0 }), RangeError);
  assert.throws(() => bench('a', () => {}, { warmup: -1 }), RangeError);
});

test('compareBench picks the faster', () => {
  const fast = bench('fast', () => {}, { iterations: 2, warmup: 0, now: clock([10]) });
  const slow = bench('slow', () => {}, { iterations: 2, warmup: 0, now: clock([40]) });
  const c = compareBench(fast, slow);
  assert.equal(c.faster, 'fast');
  assert.equal(c.speedup, 4);
  assert.equal(c.meanDelta, -30);
  assert.equal(compareBench(slow, fast).faster, 'fast');
  assert.equal(compareBench(fast, fast).faster, 'tie');
});
