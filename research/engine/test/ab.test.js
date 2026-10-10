import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareArms } from '../src/index.js';

const arm = (successes, n) => Array.from({ length: n }, (_, i) => i < successes);
const near = (x, y, eps = 1e-4) => assert.ok(Math.abs(x - y) < eps, `${x} !~ ${y}`);

test('known values: 50/100 vs 65/100', () => {
  const r = compareArms(arm(50, 100), arm(65, 100));
  near(r.lift, 0.15);
  near(r.z, 2.1457, 1e-3);
  near(r.p, 0.0319, 1e-3);
  assert.equal(r.decision, 'adopt');
});

test('significantly worse b is rejected', () => {
  const r = compareArms(arm(65, 100), arm(50, 100));
  near(r.z, -2.1457, 1e-3);
  near(r.p, 0.0319, 1e-3);
  assert.equal(r.decision, 'reject');
});

test('small difference is inconclusive', () => {
  const r = compareArms(arm(50, 100), arm(55, 100));
  assert.ok(r.p > 0.05);
  assert.equal(r.decision, 'inconclusive');
});

test('accepts 0/1 numbers and respects alpha', () => {
  const a = arm(50, 100).map(Number);
  const b = arm(65, 100).map(Number);
  assert.equal(compareArms(a, b, { alpha: 0.01 }).decision, 'inconclusive');
});

test('degenerate inputs are inconclusive', () => {
  assert.equal(compareArms([], []).decision, 'inconclusive');
  assert.equal(compareArms(arm(10, 10), arm(10, 10)).decision, 'inconclusive');
  assert.equal(compareArms(arm(0, 10), arm(0, 10)).p, 1);
  assert.throws(() => compareArms(null, []), TypeError);
});
