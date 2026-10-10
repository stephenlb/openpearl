import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLearner, createLedger, runImprovementCycle } from '../src/index.js';

const fail = (task) => ({
  strategy: 'retry',
  success: false,
  costMs: 50,
  task,
  message: `timeout after ${task}00ms`,
});

const events = [
  fail(1),
  fail(2),
  fail(3),
  { strategy: 'retry', success: true, costMs: 10 },
  { strategy: 'fallback', success: true, costMs: 20 },
  { strategy: 'fallback', success: true, costMs: 20 },
  { change: 'raise timeout', metricBefore: 0.5, metricAfter: 0.7 },
  { change: 'bad tweak', metricBefore: 0.7, metricAfter: 0.6 },
];

test('runs a full cycle over fixture events', () => {
  const ledger = createLedger({ clock: () => 1 });
  const out = runImprovementCycle({ events, learner: createLearner(), ledger });
  assert.equal(out.drafts.length, 1);
  assert.match(out.drafts[0].title, /timeout after <n>ms/);
  assert.deepEqual(out.ranked.map((r) => r.strategy), ['fallback', 'retry']);
  assert.equal(out.ranked[1].attempts, 4);
  assert.equal(out.summary.count, 2);
  assert.equal(out.summary.wins, 1);
  assert.equal(out.summary.regressions.length, 1);
});

test('skips incomplete ledger events and handles failing strategy events', () => {
  const out = runImprovementCycle({
    events: [
      { change: 'half', metricBefore: 0.5 },
      { strategy: 'retry', success: false, costMs: 5 },
    ],
    learner: createLearner(),
    ledger: createLedger(),
  });
  assert.equal(out.summary.count, 0);
  assert.equal(out.ranked[0].attempts, 1);
});

test('respects minCount and validates inputs', () => {
  const run = (o) => runImprovementCycle({ learner: createLearner(), ledger: createLedger(), ...o });
  assert.equal(run({ events, minCount: 4 }).drafts.length, 0);
  assert.deepEqual(run({ events: [] }).ranked, []);
  assert.throws(() => run({ events: null }), TypeError);
  assert.throws(() => runImprovementCycle({ events, ledger: createLedger() }), TypeError);
  assert.throws(() => runImprovementCycle({ events, learner: createLearner() }), TypeError);
});

test('skips malformed events without aborting the cycle', () => {
  const ledger = createLedger({ clock: () => 1 });
  const out = runImprovementCycle({
    events: [
      { strategy: 'a', success: true },
      { strategy: '', success: false },
      { strategy: 'b', success: true, costMs: -1 },
      { strategy: 'c', success: true, costMs: 'x' },
      { change: 'x', metricBefore: 'x', metricAfter: 1 },
      { change: 'y', metricBefore: NaN, metricAfter: 1 },
    ],
    learner: createLearner(),
    ledger,
  });
  assert.deepEqual(out.ranked.map((r) => r.strategy), ['a']);
  assert.equal(ledger.entries().length, 0);
});

test('drafts events with error but no success', () => {
  const out = runImprovementCycle({
    events: [1, 2, 3].map((n) => ({ error: 'boom', message: 'boom', task: n })),
    learner: createLearner(),
    ledger: createLedger(),
    minCount: 1,
  });
  assert.ok(out.drafts.length >= 1);
});
