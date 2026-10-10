import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tune, seededRng } from '../src/index.js';

const quad = ({ x, y }) => (x - 3) ** 2 + (y + 2) ** 2;
const params = { x: { min: -10, max: 10, value: 8 }, y: { min: -10, max: 10, value: 8 } };

test('finds the minimum of a quadratic', () => {
  const r = tune({ params, evaluate: quad, steps: 400, rng: seededRng(1) });
  assert.ok(Math.abs(r.best.x - 3) < 0.05);
  assert.ok(Math.abs(r.best.y + 2) < 0.05);
  assert.ok(r.score < 0.01);
});

test('respects the step budget and records trajectory', () => {
  let calls = 0;
  const r = tune({ params, evaluate: (p) => (calls++, quad(p)), steps: 25, rng: seededRng(2) });
  assert.equal(calls, 25);
  assert.equal(r.trajectory.length, 25);
  assert.equal(r.evaluations, 25);
  assert.equal(r.score, Math.min(...r.trajectory.map((t) => t.score)));
});

test('is deterministic for a given seed', () => {
  const a = tune({ params, evaluate: quad, steps: 200, rng: seededRng(7) });
  const b = tune({ params, evaluate: quad, steps: 200, rng: seededRng(7) });
  assert.deepEqual(a, b);
});

test('maximize and bounds', () => {
  const r = tune({
    params: { x: { min: 0, max: 5, value: 1 } },
    evaluate: ({ x }) => -((x - 9) ** 2),
    steps: 100,
    maximize: true,
    rng: seededRng(3),
  });
  assert.equal(r.best.x, 5);
});

test('random restarts escape a local optimum', () => {
  // Local max near x=2 (height 1), global near x=8 (height 2).
  const f = ({ x }) => Math.max(1 - (x - 2) ** 2, 2 - 4 * (x - 8) ** 2);
  const r = tune({
    params: { x: { min: 0, max: 10, value: 2, step: 0.5 } },
    evaluate: f,
    steps: 300,
    maximize: true,
    rng: seededRng(4),
  });
  assert.ok(r.restarts > 0);
  assert.ok(Math.abs(r.best.x - 8) < 0.05);
});

test('validates input', () => {
  assert.throws(() => tune({ params: {}, evaluate: quad }), RangeError);
  assert.throws(() => tune({ params, evaluate: null }), TypeError);
});

test('rejects invalid steps, step sizes and minStep', () => {
  for (const steps of [0, -1, NaN]) assert.throws(() => tune({ params, evaluate: quad, steps }), RangeError);
  assert.throws(() => tune({ params: { x: { min: 0, max: 1, step: 0 } }, evaluate: quad }), RangeError);
  assert.throws(() => tune({ params, evaluate: quad, minStep: 0 }), RangeError);
  assert.throws(() => tune({ params: { x: { min: 0, max: Infinity } }, evaluate: quad }), RangeError);
});

test('throws on NaN scores', () => {
  assert.throws(() => tune({ params, evaluate: () => NaN }), TypeError);
});

test('handles a degenerate range and honours minStep', () => {
  const r = tune({ params: { x: { min: 2, max: 2 } }, evaluate: ({ x }) => x, steps: 10 });
  assert.equal(r.best.x, 2);
  assert.equal(r.evaluations, 10);
  const coarse = tune({ params, evaluate: quad, steps: 400, minStep: 1, rng: seededRng(1) });
  assert.ok(coarse.restarts > 0);
});
