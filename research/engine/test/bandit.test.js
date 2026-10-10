import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBandit, seededRng } from '../src/index.js';

const P = { a: 0.2, b: 0.8, c: 0.5 };

function run(mode, seed) {
  const env = seededRng(seed + 100);
  const bandit = createBandit(Object.keys(P), { mode, epsilon: 0.1, rng: seededRng(seed) });
  const counts = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 500; i++) {
    const arm = bandit.choose();
    counts[arm]++;
    bandit.reward(arm, env() < P[arm] ? 1 : 0);
  }
  return { counts, bandit };
}

for (const mode of ['epsilon', 'thompson']) {
  test(`${mode} converges to best arm in 500 pulls`, () => {
    const { counts } = run(mode, 42);
    assert.ok(counts.b > 300, JSON.stringify(counts));
    assert.ok(counts.b > counts.a && counts.b > counts.c);
  });

  test(`${mode} is deterministic for a seed`, () => {
    assert.deepEqual(run(mode, 7).counts, run(mode, 7).counts);
  });
}

test('epsilon-greedy tries every arm first and exploits', () => {
  const b = createBandit(['x', 'y'], { epsilon: 0, rng: seededRng(1) });
  b.reward('x', 0);
  b.reward('y', 1);
  for (let i = 0; i < 5; i++) assert.equal(b.choose(), 'y');
});

test('stats and validation', () => {
  const b = createBandit(['x', 'y']);
  b.reward('x', 1);
  assert.deepEqual(b.stats().x, { pulls: 1, mean: 1 });
  assert.throws(() => b.reward('z', 1));
  assert.throws(() => b.reward('x', 2), RangeError);
  assert.throws(() => createBandit([]));
  assert.throws(() => createBandit(['x'], { mode: 'nope' }));
});
