import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBudget } from '../src/budget.js';

function setup(opts = {}) {
  let t = 0;
  const b = createBudget({ limit: 10, windowMs: 1000, now: () => t, ...opts });
  return { b, tick: (ms) => { t += ms; } };
}

test('charges reduce remaining', () => {
  const { b } = setup();
  assert.equal(b.remaining(), 10);
  assert.equal(b.charge(4), true);
  assert.equal(b.remaining(), 6);
});

test('rejects unaffordable charge without recording it', () => {
  const { b } = setup();
  b.charge(8);
  assert.equal(b.canAfford(3), false);
  assert.equal(b.charge(3), false);
  assert.equal(b.remaining(), 2);
  assert.equal(b.canAfford(2), true);
});

test('charges expire after the window', () => {
  const { b, tick } = setup();
  b.charge(5);
  tick(500);
  b.charge(5);
  assert.equal(b.remaining(), 0);
  tick(500); // first charge now exactly windowMs old
  assert.equal(b.remaining(), 5);
  tick(500);
  assert.equal(b.remaining(), 10);
});

test('canAfford defaults to cost 1', () => {
  const { b } = setup({ limit: 1 });
  assert.equal(b.canAfford(), true);
  b.charge();
  assert.equal(b.canAfford(), false);
});

test('validates arguments', () => {
  assert.throws(() => createBudget({ limit: -1, windowMs: 10 }), RangeError);
  assert.throws(() => createBudget({ limit: 1, windowMs: 0 }), RangeError);
  const { b } = setup();
  assert.throws(() => b.charge(-1), RangeError);
});
