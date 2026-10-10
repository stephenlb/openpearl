import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBreaker } from '../src/index.js';

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
