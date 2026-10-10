import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankStrategies, wilsonLowerBound } from '../src/strategy.js';

const learner = (table) => ({ stats: (id) => table[id] });
const ids = (list) => list.map((c) => c.id);

test('wilson lower bound basics', () => {
  assert.equal(wilsonLowerBound(0, 0), 0);
  assert.ok(wilsonLowerBound(10, 0) < 1);
  assert.ok(wilsonLowerBound(100, 0) > wilsonLowerBound(10, 0));
  assert.equal(wilsonLowerBound(0, 5), 0);
});

test('more evidence beats a lucky small sample', () => {
  const l = learner({ a: { successes: 2, failures: 0 }, b: { successes: 90, failures: 10 } });
  const out = rankStrategies(l, [{ id: 'a', cost: 1 }, { id: 'b', cost: 1 }]);
  assert.deepEqual(ids(out), ['b', 'a']);
});

test('equal score is ordered by lower cost', () => {
  const s = { successes: 8, failures: 2 };
  const l = learner({ a: s, b: s });
  const out = rankStrategies(l, [{ id: 'a', cost: 5 }, { id: 'b', cost: 1 }]);
  assert.deepEqual(ids(out), ['b', 'a']);
});

test('full ties are stable and unknown ids score zero', () => {
  const l = learner({});
  const input = [{ id: 'x', cost: 1 }, { id: 'y', cost: 1 }, { id: 'z', cost: 1 }];
  assert.deepEqual(ids(rankStrategies(l, input)), ['x', 'y', 'z']);
});

test('does not mutate input and validates arguments', () => {
  const input = [{ id: 'a', cost: 2 }, { id: 'b', cost: 1 }];
  rankStrategies(learner({}), input);
  assert.deepEqual(ids(input), ['a', 'b']);
  assert.throws(() => rankStrategies({}, []), TypeError);
  assert.throws(() => rankStrategies(learner({}), null), TypeError);
});
