import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBreaker, BreakerOpenError } from '../src/index.js';

const fail = async () => { throw new Error('boom'); };
const ok = async () => 'ok';

function setup() {
  let t = 1000;
  const breaker = createBreaker({ threshold: 3, cooldownMs: 100, now: () => t });
  return { breaker, advance: (ms) => { t += ms; } };
}

async function failTimes(breaker, n) {
  for (let i = 0; i < n; i++) await assert.rejects(breaker.call(fail), /boom/);
}

test('starts closed and passes results through', async () => {
  const { breaker } = setup();
  assert.equal(breaker.state(), 'closed');
  assert.equal(await breaker.call(ok), 'ok');
});

test('closed -> open after threshold consecutive failures', async () => {
  const { breaker } = setup();
  await failTimes(breaker, 2);
  assert.equal(breaker.state(), 'closed');
  await failTimes(breaker, 1);
  assert.equal(breaker.state(), 'open');
});

test('success resets the failure count', async () => {
  const { breaker } = setup();
  await failTimes(breaker, 2);
  await breaker.call(ok);
  await failTimes(breaker, 2);
  assert.equal(breaker.state(), 'closed');
});

test('open rejects without invoking fn', async () => {
  const { breaker } = setup();
  await failTimes(breaker, 3);
  let called = false;
  await assert.rejects(breaker.call(async () => { called = true; }), /open/);
  assert.equal(called, false);
});

test('open -> half-open after cooldown', async () => {
  const { breaker, advance } = setup();
  await failTimes(breaker, 3);
  advance(99);
  assert.equal(breaker.state(), 'open');
  advance(1);
  assert.equal(breaker.state(), 'half-open');
});

test('half-open -> closed on successful probe', async () => {
  const { breaker, advance } = setup();
  await failTimes(breaker, 3);
  advance(100);
  assert.equal(await breaker.call(ok), 'ok');
  assert.equal(breaker.state(), 'closed');
});

test('half-open -> open on failed probe, restarting cooldown', async () => {
  const { breaker, advance } = setup();
  await failTimes(breaker, 3);
  advance(100);
  await assert.rejects(breaker.call(fail), /boom/);
  assert.equal(breaker.state(), 'open');
  advance(99);
  assert.equal(breaker.state(), 'open');
  advance(1);
  assert.equal(breaker.state(), 'half-open');
});

test('half-open allows only one concurrent probe', async () => {
  const { breaker, advance } = setup();
  await failTimes(breaker, 3);
  advance(100);
  let release;
  const probe = breaker.call(() => new Promise((r) => { release = r; }));
  await assert.rejects(breaker.call(ok), /open/);
  release('done');
  assert.equal(await probe, 'done');
  assert.equal(breaker.state(), 'closed');
});

test('defaults: threshold 5, cooldown 30000', async () => {
  let t = 0;
  const breaker = createBreaker({ now: () => t });
  await failTimes(breaker, 4);
  assert.equal(breaker.state(), 'closed');
  await failTimes(breaker, 1);
  assert.equal(breaker.state(), 'open');
  t = 29999;
  assert.equal(breaker.state(), 'open');
  t = 30000;
  assert.equal(breaker.state(), 'half-open');
});

test('slow call started before trip cannot close the breaker', async () => {
  const { breaker } = setup();
  let release;
  const slow = breaker.call(() => new Promise((r) => { release = r; }));
  await failTimes(breaker, 3);
  assert.equal(breaker.state(), 'open');
  release('late');
  assert.equal(await slow, 'late');
  assert.equal(breaker.state(), 'open');
});

test('slow failure started before trip does not restart cooldown', async () => {
  const { breaker, advance } = setup();
  let reject;
  const slow = breaker.call(() => new Promise((_, r) => { reject = r; }));
  await failTimes(breaker, 3);
  advance(100);
  reject(new Error('late'));
  await assert.rejects(slow, /late/);
  assert.equal(breaker.state(), 'half-open');
});

test('rejection is a BreakerOpenError', async () => {
  const { breaker } = setup();
  await failTimes(breaker, 3);
  await assert.rejects(breaker.call(ok), BreakerOpenError);
});

test('reset() ignores results of calls started before it', async () => {
  const { breaker } = setup();
  let rejectPending;
  const pending = breaker.call(() => new Promise((_, rej) => { rejectPending = rej; }));
  breaker.reset();
  rejectPending(new Error('late'));
  await assert.rejects(pending, /late/);
  await failTimes(breaker, 2);
  assert.equal(breaker.state(), 'closed');
});

test('reset() during a probe does not allow a third concurrent probe', async () => {
  const { breaker, advance } = setup();
  await failTimes(breaker, 3);
  advance(100);
  let release1;
  const p1 = breaker.call(() => new Promise((r) => { release1 = r; }));
  breaker.reset();
  await failTimes(breaker, 3);
  advance(100);
  let release2;
  const p2 = breaker.call(() => new Promise((r) => { release2 = r; }));
  release1('a');
  await p1;
  await assert.rejects(breaker.call(ok), BreakerOpenError);
  release2('b');
  await p2;
});

test('synchronously throwing fn counts as a failure', async () => {
  const { breaker } = setup();
  const boom = () => { throw new Error('sync'); };
  for (let i = 0; i < 3; i++) await assert.rejects(breaker.call(boom), /sync/);
  assert.equal(breaker.state(), 'open');
});
