import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics } from '../src/index.js';

test('empty snapshot', () => {
  assert.deepEqual(createMetrics().snapshot(), { counters: {}, histograms: {} });
});

test('inc defaults to 1 and accumulates', () => {
  const m = createMetrics();
  m.inc('a');
  m.inc('a', 4);
  m.inc('b', 2);
  assert.deepEqual(m.snapshot().counters, { a: 5, b: 2 });
});

test('histogram stats over 1..100', () => {
  const m = createMetrics();
  for (let i = 100; i >= 1; i--) m.observe('lat', i);
  assert.deepEqual(m.snapshot().histograms.lat, {
    count: 100, min: 1, max: 100, mean: 50.5, p50: 50, p95: 95, p99: 99,
  });
});

test('single value histogram', () => {
  const m = createMetrics();
  m.observe('x', 7);
  assert.deepEqual(m.snapshot().histograms.x, {
    count: 1, min: 7, max: 7, mean: 7, p50: 7, p95: 7, p99: 7,
  });
});

test('small unsorted sample', () => {
  const m = createMetrics();
  for (const v of [10, 2, 8, 4]) m.observe('x', v);
  const h = m.snapshot().histograms.x;
  assert.equal(h.p50, 4);
  assert.equal(h.p95, 10);
  assert.equal(h.mean, 6);
});
