import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLedger } from '../src/index.js';

test('empty summary', () => {
  assert.deepEqual(createLedger().summary(), {
    count: 0, netImprovement: 0, wins: 0, winRate: 0, regressions: [],
  });
});

test('records with injected clock', () => {
  let t = 100;
  const l = createLedger({ clock: () => t++ });
  l.record('a', 1, 2);
  l.record('b', 2, 3);
  assert.deepEqual(l.entries().map((e) => e.ts), [100, 101]);
  assert.deepEqual(l.entries()[0], { change: 'a', metricBefore: 1, metricAfter: 2, ts: 100 });
});

test('summary: net, win rate, regressions', () => {
  const l = createLedger({ clock: () => 0 });
  l.record('a', 0.5, 0.7);
  l.record('b', 0.7, 0.6);
  l.record('c', 0.6, 0.6);
  l.record('d', 0.6, 0.9);
  const s = l.summary();
  assert.equal(s.count, 4);
  assert.ok(Math.abs(s.netImprovement - 0.4) < 1e-9);
  assert.equal(s.wins, 2);
  assert.equal(s.winRate, 0.5);
  assert.equal(s.regressions.length, 1);
  assert.equal(s.regressions[0].change, 'b');
});

test('higherIsBetter=false flips direction', () => {
  const l = createLedger({ higherIsBetter: false });
  l.record('faster', 10, 6);
  l.record('slower', 6, 9);
  const s = l.summary();
  assert.equal(s.netImprovement, 1);
  assert.equal(s.wins, 1);
  assert.equal(s.regressions[0].change, 'slower');
});

test('tolerance ignores small noise', () => {
  const l = createLedger({ tolerance: 0.05 });
  l.record('noise', 1, 0.97);
  l.record('noise-up', 1, 1.03);
  const s = l.summary();
  assert.equal(s.regressions.length, 0);
  assert.equal(s.wins, 0);
});

test('rejects non-finite metrics', () => {
  assert.throws(() => createLedger().record('x', NaN, 1), TypeError);
});
