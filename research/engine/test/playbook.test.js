import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlaybook, createBreaker } from '../src/index.js';

const transient = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
const types = (r) => r.actions.map((a) => `${a.type}:${a.result}`);

test('backoff then retry heals, with injected sleep and rng', async () => {
  const pb = createPlaybook({ transient: ['backoff', 'retry'] });
  const sleeps = [];
  const r = await pb.heal(transient, {
    run: async () => 42,
    sleep: async (ms) => { sleeps.push(ms); },
    rng: () => 0.5,
  });
  assert.equal(r.outcome, 'healed');
  assert.equal(r.value, 42);
  assert.equal(r.class, 'transient');
  assert.deepEqual(sleeps, [100]);
  assert.deepEqual(types(r), ['backoff:ok', 'retry:ok']);
});

test('backoff delay grows across steps', async () => {
  const pb = createPlaybook({ transient: ['backoff', 'backoff'] });
  const r = await pb.heal(transient, { sleep: async () => {}, rng: () => 0.5 });
  assert.deepEqual(r.actions.map((a) => a.delayMs), [100, 200]);
  assert.equal(r.outcome, 'unhealed');
});

test('reset-breaker closes an open breaker so retry succeeds', async () => {
  let t = 0;
  const breaker = createBreaker({ threshold: 1, cooldownMs: 1000, now: () => t });
  await assert.rejects(breaker.call(async () => { throw transient; }));
  assert.equal(breaker.state(), 'open');
  const pb = createPlaybook({ transient: ['retry', 'reset-breaker', 'retry'] });
  const r = await pb.heal(transient, { breaker, run: () => breaker.call(async () => 'fine') });
  assert.equal(r.outcome, 'healed');
  assert.deepEqual(types(r), ['retry:failed', 'reset-breaker:ok', 'retry:ok']);
  assert.equal(breaker.state(), 'closed');
});

test('degrade after failed retries', async () => {
  const pb = createPlaybook({ timeout: [{ type: 'retry', times: 2 }, 'degrade'] });
  const err = Object.assign(new Error('x'), { code: 'ETIMEDOUT' });
  const r = await pb.heal(err, {
    run: async () => { throw new Error('still'); },
    degrade: async () => 'cached',
  });
  assert.equal(r.outcome, 'degraded');
  assert.equal(r.value, 'cached');
  assert.deepEqual(types(r), ['retry:failed', 'retry:failed', 'degrade:ok']);
});

test('replay-dlq is recorded and does not end the playbook', async () => {
  const pb = createPlaybook({ resource: ['replay-dlq', 'retry'] });
  const err = Object.assign(new Error('x'), { code: 'ENOMEM' });
  const r = await pb.heal(err, { dlq: { replay: async () => 3 }, run: async () => 'ok' });
  assert.equal(r.actions[0].replayed, 3);
  assert.equal(r.outcome, 'healed');
});

test('missing capabilities are skipped; unmatched class is unhealed', async () => {
  const pb = createPlaybook({ transient: ['retry', 'reset-breaker', 'replay-dlq', 'degrade', 'backoff'] });
  const r = await pb.heal(transient, {});
  assert.equal(r.outcome, 'unhealed');
  assert.ok(r.actions.every((a) => a.result === 'skipped'));
  const none = await createPlaybook({}).heal(new Error('?'), {});
  assert.deepEqual(none, { class: 'unknown', actions: [], outcome: 'unhealed' });
});

test('default rule applies to classes without their own', async () => {
  const pb = createPlaybook({ default: ['degrade'] });
  const r = await pb.heal(new Error('weird'), { degrade: () => 'd' });
  assert.equal(r.outcome, 'degraded');
});

test('default rules degrade permanent errors without retrying', async () => {
  const pb = createPlaybook();
  let ran = false;
  const r = await pb.heal(Object.assign(new Error('x'), { code: 'EACCES' }), {
    run: async () => { ran = true; },
    degrade: () => 'fallback',
  });
  assert.equal(ran, false);
  assert.equal(r.outcome, 'degraded');
});

test('invalid rules throw', () => {
  assert.throws(() => createPlaybook({ transient: ['explode'] }), TypeError);
  assert.throws(() => createPlaybook({ transient: 'retry' }), TypeError);
});
