import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../src/index.js';

test('simulate is deterministic for a given seed', async () => {
  const a = await simulate({ jobs: 200, failRate: 0.4, seed: 7 });
  const b = await simulate({ jobs: 200, failRate: 0.4, seed: 7 });
  assert.deepEqual(a, b);
});

test('healing improves success rate under chaos', async () => {
  const r = await simulate({ jobs: 300, failRate: 0.4, seed: 3 });
  assert.ok(r.healing.successRate > r.baseline.successRate);
  assert.equal(r.baseline.meanAttempts, 1);
  assert.ok(r.healing.meanAttempts > 1);
  assert.ok(r.healing.p95LatencyMs >= r.baseline.p95LatencyMs);
  assert.equal(r.delta.successRate, r.healing.successRate - r.baseline.successRate);
});

test('no faults gives perfect runs and zero MTTR', async () => {
  const r = await simulate({ jobs: 50, failRate: 0, seed: 1 });
  assert.equal(r.baseline.successRate, 1);
  assert.equal(r.healing.successRate, 1);
  assert.equal(r.baseline.mttrMs, 0);
  assert.equal(r.healing.meanAttempts, 1);
});

test('rejects invalid input', async () => {
  await assert.rejects(simulate({ jobs: -1 }), RangeError);
  await assert.rejects(simulate({ failRate: 2 }), RangeError);
});
