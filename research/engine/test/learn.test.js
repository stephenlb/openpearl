import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLearner, wilsonLowerBound } from '../src/index.js';

const close = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('unknown strategy has zeroed stats', () => {
  assert.deepEqual(createLearner().stats('x'), {
    attempts: 0,
    successRate: 0,
    meanCost: 0,
    wilsonLower: 0,
  });
});

test('computes rate, mean cost and wilson bound for known data', () => {
  const l = createLearner();
  for (let i = 0; i < 8; i++) l.record({ strategy: 'retry', context: {}, success: true, costMs: 10 });
  for (let i = 0; i < 2; i++) l.record({ strategy: 'retry', context: {}, success: false, costMs: 60 });
  const s = l.stats('retry');
  assert.equal(s.attempts, 10);
  assert.equal(s.successRate, 0.8);
  assert.equal(s.meanCost, 20);
  close(s.wilsonLower, 0.4902); // Wilson 95% lower bound for 8/10
});

test('wilson bound edge cases and strategies are independent', () => {
  assert.equal(wilsonLowerBound(0, 0), 0);
  assert.equal(wilsonLowerBound(0, 5), 0);
  close(wilsonLowerBound(10, 10), 0.7225);
  const l = createLearner();
  l.record({ strategy: 'a', success: true, costMs: 5 });
  l.record({ strategy: 'b', success: false, costMs: 7 });
  assert.equal(l.stats('a').successRate, 1);
  assert.equal(l.stats('b').successRate, 0);
});

test('rejects invalid input', () => {
  const l = createLearner();
  assert.throws(() => l.record({ success: true }), TypeError);
  assert.throws(() => l.record({ strategy: 'a', success: true, costMs: -1 }), RangeError);
});
