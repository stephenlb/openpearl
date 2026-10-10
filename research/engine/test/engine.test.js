import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createChaos, seededRng } from '../src/index.js';

const noSleep = async () => {};

function makeClock() {
  let t = 0;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

async function successRate({ healing, seed, n = 300, failRate = 0.4 }) {
  const clock = makeClock();
  const engine = createEngine({
    healing,
    now: clock.now,
    sleep: noSleep,
    breaker: { threshold: 1000 },
    limiter: { max: 10 },
  });
  const chaos = createChaos({ rng: seededRng(seed), failRate, sleep: noSleep });
  const task = chaos.wrap(async () => 'ok');
  let ok = 0;
  for (let i = 0; i < n; i++) {
    const r = await engine.run('job', task);
    if (r.ok) ok++;
  }
  return { rate: ok / n, engine };
}

test('healing improves success rate under chaos (seeded)', async () => {
  const on = await successRate({ healing: true, seed: 42 });
  const off = await successRate({ healing: false, seed: 42 });
  assert.ok(on.rate > off.rate, `${on.rate} should exceed ${off.rate}`);
  assert.ok(on.rate > 0.9);
  assert.ok(off.rate < 0.75);
});

test('is deterministic for a given seed', async () => {
  const a = await successRate({ healing: true, seed: 7 });
  const b = await successRate({ healing: true, seed: 7 });
  assert.equal(a.rate, b.rate);
});

test('records metrics and learner stats', async () => {
  const { engine } = await successRate({ healing: true, seed: 1, n: 50 });
  const snap = engine.metrics();
  assert.equal(snap.counters.runs, 50);
  assert.equal(snap.counters.success + (snap.counters.failure ?? 0), 50);
  assert.equal(engine.stats('job').attempts, 50);
});

test('caches successful values by key', async () => {
  const clock = makeClock();
  const engine = createEngine({ now: clock.now, cache: { ttlMs: 100 } });
  let calls = 0;
  const fn = async () => ++calls;
  const a = await engine.run('x', fn, { cacheKey: 'k' });
  const b = await engine.run('x', fn, { cacheKey: 'k' });
  assert.equal(a.value, 1);
  assert.equal(b.value, 1);
  assert.equal(b.cached, true);
  clock.advance(200);
  const c = await engine.run('x', fn, { cacheKey: 'k' });
  assert.equal(c.value, 2);
});

test('breaker opens after repeated failures and recovers after cooldown', async () => {
  const clock = makeClock();
  const engine = createEngine({
    now: clock.now,
    sleep: noSleep,
    retries: 0,
    breaker: { threshold: 2, cooldownMs: 1000 },
  });
  const bad = async () => { throw new Error('boom'); };
  await engine.run('x', bad);
  await engine.run('x', bad);
  assert.equal(engine.breakerState(), 'open');
  clock.advance(1000);
  const r = await engine.run('x', async () => 'fine');
  assert.equal(r.ok, true);
  assert.equal(engine.breakerState(), 'closed');
});

test('adaptive timeout fails slow calls with a timeout error', async () => {
  const timers = [];
  const engine = createEngine({
    retries: 0,
    timeout: { min: 1, max: 50 },
    setTimer: (cb) => { timers.push(cb); return timers.length; },
    clearTimer: () => {},
  });
  const p = engine.run('slow', () => new Promise(() => {}));
  await Promise.resolve();
  timers[0]();
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(r.error.name, 'TimeoutError');
  assert.equal(engine.metrics().counters['error.timeout'], 1);
});

test('sheds work beyond the concurrency limit', async () => {
  const engine = createEngine({ limiter: { min: 1, max: 1 } });
  let release;
  const first = engine.run('a', () => new Promise((res) => { release = res; }));
  const second = await engine.run('b', async () => 1);
  assert.equal(second.shed, true);
  release('done');
  assert.equal((await first).ok, true);
});

test('validates arguments', async () => {
  const engine = createEngine();
  await assert.rejects(() => engine.run('', async () => 1), TypeError);
  await assert.rejects(() => engine.run('x', null), TypeError);
});

test('breaker rejections are not retried or counted as errors', async () => {
  const clock = makeClock();
  let sleeps = 0;
  const engine = createEngine({
    now: clock.now,
    sleep: async () => { sleeps++; },
    delayMs: 5,
    retries: 3,
    breaker: { threshold: 1, cooldownMs: 1000 },
  });
  await engine.run('x', async () => { throw new Error('boom'); });
  sleeps = 0;
  const r = await engine.run('x', async () => 1);
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 1);
  assert.equal(sleeps, 0);
  assert.equal(engine.metrics().counters['breaker.rejected'], 1);
});

test('caches undefined results; cacheKey without a cache just runs', async () => {
  const engine = createEngine({ cache: { ttlMs: 100 } });
  let calls = 0;
  const fn = async () => { calls++; };
  await engine.run('x', fn, { cacheKey: 'k' });
  const b = await engine.run('x', fn, { cacheKey: 'k' });
  assert.equal(b.cached, true);
  assert.equal(calls, 1);
  const bare = createEngine();
  assert.equal((await bare.run('x', async () => 5, { cacheKey: 'k' })).value, 5);
});

test('counts shed runs and makes a single attempt with healing off', async () => {
  const engine = createEngine({ healing: false, limiter: { min: 1, max: 1 } });
  let release;
  const first = engine.run('a', () => new Promise((res) => { release = res; }));
  await engine.run('b', async () => 1);
  release(1);
  await first;
  assert.equal(engine.metrics().counters.shed, 1);
  const bad = await engine.run('c', async () => { throw new Error('x'); });
  assert.equal(bad.attempts, 1);
});
