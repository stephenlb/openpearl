import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../src/cache.js';

const clock = () => {
  let t = 0;
  const f = () => t;
  f.adv = (ms) => { t += ms; };
  return f;
};

test('non-adaptive cache behaves identically without per-key history', () => {
  const now = clock();
  const c = createCache({ ttlMs: 100, now, maxEntries: 2 });
  for (let i = 0; i < 5000; i++) c.get(`k${i}`);
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  assert.equal(c.get('a'), undefined);
  assert.equal(c.get('c'), 3);
  const st = c.stats();
  assert.equal(st.evictions, 1);
  assert.equal(st.hits, 1);
  assert.equal(st.misses, 5001);
  now.adv(100);
  assert.equal(c.get('c'), undefined);
  assert.equal(c.stats().expirations, 1);
});

test('benchmark: non-adaptive hot loop is not slower than adaptive', () => {
  const run = (adaptive) => {
    const c = createCache({ ttlMs: 1e9, adaptive, maxEntries: 100 });
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 100000; i++) { const k = i % 100; if (c.get(k) === undefined) c.set(k, i); }
    return Number(process.hrtime.bigint() - t0);
  };
  run(false); run(true); // warm up
  const fast = Math.min(run(false), run(false), run(false));
  const slow = Math.min(run(true), run(true), run(true));
  assert.ok(fast <= slow * 1.5, `non-adaptive ${fast}ns vs adaptive ${slow}ns`);
});
