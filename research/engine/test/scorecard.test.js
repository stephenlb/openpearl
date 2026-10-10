import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorecard, WEIGHTS, OVERALL_WEIGHTS } from '../src/scorecard.js';

const perfect = {
  healing: { recoveryRate: 1, availability: 1, repairRate: 1 },
  improving: { fixRate: 1, regressionCoverage: 1, qualityGain: 1 },
  optimizing: { latencyGain: 1, costSaving: 1, throughputGain: 1 },
};

test('weights sum to 1', () => {
  for (const w of Object.values(WEIGHTS)) {
    assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  }
  assert.ok(Math.abs(Object.values(OVERALL_WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('perfect results score 100, empty score 0', () => {
  const p = scorecard(perfect);
  assert.deepEqual([p.healing, p.improving, p.optimizing, p.overall], [100, 100, 100, 100]);
  const e = scorecard();
  assert.deepEqual([e.healing, e.improving, e.optimizing, e.overall], [0, 0, 0, 0]);
});

test('weighted partial scores', () => {
  const c = scorecard({ healing: { recoveryRate: 1 }, improving: { fixRate: 0.5 } });
  assert.equal(c.healing, 50);
  assert.equal(c.improving, 20);
  assert.equal(c.optimizing, 0);
  assert.equal(c.overall, 26);
});

test('out-of-range and invalid values are clamped', () => {
  const c = scorecard({ healing: { recoveryRate: 5, availability: -1, repairRate: NaN } });
  assert.equal(c.healing, 50);
});

test('markdown rendering', () => {
  const md = scorecard(perfect).markdown();
  assert.match(md, /\| self-healing \| 100 \| 0.4 \|/);
  assert.match(md, /\*\*overall\*\* \| \*\*100\*\*/);
});
