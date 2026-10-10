import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShedder } from '../src/index.js';

test('admits everything below limits', () => {
  const s = createShedder({ maxQueue: 4 });
  for (let i = 0; i < 3; i++) assert.equal(s.admit(0).admitted, true);
  assert.equal(s.depth, 3);
});

test('sheds lowest priority first as queue grows', () => {
  const s = createShedder({ maxQueue: 3, priority: 3 });
  for (let i = 0; i < 3; i++) s.admit(2);
  const low = s.admit(0);
  assert.equal(low.admitted, false);
  assert.equal(low.reason, 'queue');
  assert.equal(s.admit(1).admitted, true); // load 1 -> cutoff 1
  assert.equal(s.admit(2).admitted, true); // load 4/3 -> cutoff 2
  assert.equal(s.admit(1).admitted, false);
  assert.equal(s.depth, 5);
  assert.equal(s.admit(2).admitted, true); // load 5/3 -> top level is never shed
});

test('done frees capacity', () => {
  const s = createShedder({ maxQueue: 1, priority: 2 });
  assert.ok(s.admit(1).admitted);
  assert.equal(s.admit(0).admitted, false);
  s.done();
  assert.ok(s.admit(0).admitted);
  assert.deepEqual(s.stats(), { admitted: 2, shed: 1 });
});

test('sheds on latency', () => {
  const s = createShedder({ maxQueue: 10, maxLatencyMs: 100, priority: 2 });
  s.admit(1);
  s.done(150);
  const r = s.admit(0);
  assert.equal(r.admitted, false);
  assert.equal(r.reason, 'latency');
  assert.equal(s.admit(1).admitted, true);
});

test('latency EWMA recovers', () => {
  const s = createShedder({ maxQueue: 10, maxLatencyMs: 100, priority: 2, alpha: 0.5 });
  s.admit();
  s.done(300);
  assert.equal(s.admit(0).admitted, false);
  for (let i = 0; i < 6; i++) {
    s.admit();
    s.done(10);
  }
  assert.ok(s.latency < 100);
  assert.ok(s.admit(0).admitted);
});

test('validates input', () => {
  assert.throws(() => createShedder({}), RangeError);
  assert.throws(() => createShedder({ maxQueue: 1, priority: 0 }), RangeError);
  assert.throws(() => createShedder({ maxQueue: 1, maxLatencyMs: 0 }), RangeError);
  const s = createShedder({ maxQueue: 1 });
  assert.throws(() => s.admit(5), RangeError);
  assert.throws(() => s.done(), /without matching/);
});
