import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWatchdog } from '../src/index.js';

function setup(timeoutMs = 100) {
  const clock = { t: 0 };
  const stalls = [];
  const wd = createWatchdog({ timeoutMs, now: () => clock.t, onStall: (id) => stalls.push(id) });
  return { clock, stalls, wd };
}

test('no stalls while heartbeats are fresh', () => {
  const { clock, stalls, wd } = setup();
  wd.heartbeat('a');
  clock.t = 100;
  assert.deepEqual(wd.check(), []);
  assert.deepEqual(stalls, []);
});

test('reports stalled ids and calls onStall once per stall', () => {
  const { clock, stalls, wd } = setup();
  wd.heartbeat('a');
  wd.heartbeat('b');
  clock.t = 50;
  wd.heartbeat('b');
  clock.t = 120;
  assert.deepEqual(wd.check(), ['a']);
  clock.t = 130;
  assert.deepEqual(wd.check(), ['a']);
  assert.deepEqual(stalls, ['a']);
});

test('heartbeat re-arms a stalled id', () => {
  const { clock, stalls, wd } = setup();
  wd.heartbeat('a');
  clock.t = 200;
  wd.check();
  wd.heartbeat('a');
  assert.deepEqual(wd.check(), []);
  clock.t = 400;
  assert.deepEqual(wd.check(), ['a']);
  assert.deepEqual(stalls, ['a', 'a']);
});

test('remove stops tracking an id', () => {
  const { clock, wd } = setup();
  wd.heartbeat('a');
  assert.equal(wd.remove('a'), true);
  clock.t = 500;
  assert.deepEqual(wd.check(), []);
});

test('rejects invalid timeoutMs', () => {
  assert.throws(() => createWatchdog({ timeoutMs: 0 }), RangeError);
  assert.throws(() => createWatchdog({}), RangeError);
});
