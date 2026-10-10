import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDegrader } from '../src/index.js';

function setup(opts = {}) {
  const clock = { t: 0 };
  const changes = [];
  const d = createDegrader({
    windowMs: 1000,
    minSamples: 4,
    holdMs: 500,
    now: () => clock.t,
    onChange: (to, from) => changes.push(`${from.name}>${to.name}`),
    ...opts,
  });
  return { clock, changes, d };
}

function feed(d, clock, oks) {
  for (const ok of oks) {
    clock.t += 10;
    d.record(ok);
  }
}

test('starts at full and ignores errors below minSamples', () => {
  const { clock, d } = setup();
  feed(d, clock, [false, false, false]);
  assert.equal(d.level().name, 'full');
});

test('degrades as error rate crosses thresholds', () => {
  const { clock, changes, d } = setup();
  feed(d, clock, [true, true, true, false]); // 25%
  assert.equal(d.level().name, 'reduced');
  feed(d, clock, [false, false, false]); // 4/7
  assert.equal(d.level().name, 'minimal');
  assert.deepEqual(changes, ['full>reduced', 'reduced>minimal']);
});

test('recovery needs low rate and hold time, one step at a time', () => {
  const { clock, d } = setup();
  feed(d, clock, [false, false, false, false]);
  assert.equal(d.level().name, 'minimal');
  clock.t += 1100; // errors age out of the window
  assert.equal(d.errorRate(), 0);
  assert.equal(d.level().name, 'reduced');
  clock.t += 400;
  assert.equal(d.level().name, 'reduced'); // hold not elapsed
  clock.t += 100;
  assert.equal(d.level().name, 'full');
});

test('hysteresis: rate between exit and enter thresholds holds the level', () => {
  const { clock, d } = setup();
  feed(d, clock, [true, true, true, false]); // 25% -> reduced
  clock.t += 600; // hold elapsed, samples still in window
  feed(d, clock, [true]); // 1/5 = 20%: below enter (25%), above exit (12.5%)
  assert.equal(d.level().name, 'reduced');
});

test('rejects invalid configuration', () => {
  assert.throws(() => createDegrader({ levels: [{ name: 'a', enterAt: 0 }] }), RangeError);
  assert.throws(
    () => createDegrader({ levels: [{ name: 'a', enterAt: 0 }, { name: 'b', enterAt: 0 }] }),
    RangeError,
  );
  assert.throws(() => createDegrader({ windowMs: 0 }), RangeError);
});
