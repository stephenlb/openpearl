import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache, adaptTtl } from '../src/cache.js';

const clock = () => {
  let t = 0;
  const f = () => t;
  f.adv = (ms) => { t += ms; };
  return f;
};

test('get/set and hit rate', () => {
  const c = createCache({ ttlMs: 100, now: clock() });
  assert.equal(c.get('a'), undefined);
  c.set('a', 1);
  assert.equal(c.get('a'), 1);
  const st = c.stats();
  assert.equal(st.hits, 1);
  assert.equal(st.misses, 1);
  assert.equal(st.hitRate, 0.5);
});

test('entries expire after ttl', () => {
  const now = clock();
  const c = createCache({ ttlMs: 100, now });
  c.set('a', 1);
  now.adv(99);
  assert.equal(c.get('a'), 1);
  now.adv(1);
  assert.equal(c.get('a'), undefined);
  assert.equal(c.stats().expirations, 1);
  assert.equal(c.stats().size, 0);
});

test('LRU eviction respects recent use', () => {
  const c = createCache({ ttlMs: 100, now: clock(), maxEntries: 2 });
  c.set('a', 1);
  c.set('b', 2);
  c.get('a');
  c.set('c', 3);
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('a'), 1);
  assert.equal(c.stats().evictions, 1);
});

test('adaptTtl raises ttl only for high hit rate with enough samples', () => {
  assert.equal(adaptTtl({ ttlMs: 100, hits: 9, misses: 1 }), 200);
  assert.equal(adaptTtl({ ttlMs: 100, hits: 4, misses: 0 }), 100);
  assert.equal(adaptTtl({ ttlMs: 100, hits: 5, misses: 5 }), 100);
  assert.equal(adaptTtl({ ttlMs: 100, hits: 10, misses: 0, factor: 10, maxTtlMs: 300 }), 300);
});

test('adaptive cache lengthens ttl for hot keys', () => {
  const now = clock();
  const c = createCache({ ttlMs: 100, now, adaptive: true });
  c.set('hot', 1);
  c.set('cold', 1);
  for (let i = 0; i < 6; i++) c.get('hot');
  c.set('hot', 2);
  c.set('cold', 2);
  now.adv(150);
  assert.equal(c.get('hot'), 2);
  assert.equal(c.get('cold'), undefined);
});

test('validates options', () => {
  assert.throws(() => createCache({ ttlMs: 0 }), RangeError);
  assert.throws(() => createCache({ ttlMs: 1, maxEntries: 0 }), RangeError);
});

test('adaptTtl rejects invalid options', () => {
  assert.throws(() => adaptTtl({ ttlMs: 0 }), RangeError);
  assert.throws(() => adaptTtl({ ttlMs: 10, factor: 0.5 }), RangeError);
  assert.throws(() => adaptTtl({ ttlMs: 10, factor: NaN }), RangeError);
  assert.throws(() => adaptTtl({ ttlMs: 10, threshold: 0 }), RangeError);
  assert.throws(() => adaptTtl({ ttlMs: 10, threshold: 1.5 }), RangeError);
  assert.throws(() => createCache({ ttlMs: 10, adaptive: true, factor: -1 }), RangeError);
});

test('adaptive ttl is capped by maxTtlMs', () => {
  const now = clock();
  const c = createCache({ ttlMs: 100, now, adaptive: true, minSamples: 2, factor: 4, maxTtlMs: 200 });
  c.set('a', 1);
  c.get('a'); c.get('a'); c.get('a');
  c.set('a', 1);
  now.adv(199);
  assert.equal(c.get('a'), 1);
  now.adv(1);
  assert.equal(c.get('a'), undefined);
});

test('set on existing key refreshes recency', () => {
  const c = createCache({ ttlMs: 100, now: clock(), maxEntries: 2 });
  c.set('a', 1);
  c.set('b', 2);
  c.set('a', 3);
  c.set('c', 4);
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('a'), 3);
});

test('history is bounded', () => {
  const c = createCache({ ttlMs: 100, now: clock(), adaptive: true, minSamples: 1 });
  for (let i = 0; i < 2000; i++) c.get(`k${i}`);
  assert.equal(c.stats().misses, 2000);
});
