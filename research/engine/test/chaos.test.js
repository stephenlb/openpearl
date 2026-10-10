import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChaos, ChaosError, seededRng } from '../src/index.js';

class NetError extends Error {}
class DiskError extends Error {}

test('seededRng is deterministic and in [0, 1)', () => {
  const a = seededRng(42);
  const b = seededRng(42);
  const xs = Array.from({ length: 100 }, a);
  assert.deepEqual(xs, Array.from({ length: 100 }, b));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(xs.slice(0, 5), Array.from({ length: 5 }, seededRng(43)));
});

test('failRate 0 never throws and passes args/result through', async () => {
  const chaos = createChaos({ rng: seededRng(1), failRate: 0 });
  const fn = chaos.wrap((a, b) => a + b);
  for (let i = 0; i < 50; i++) assert.equal(await fn(1, 2), 3);
});

test('failRate 1 always throws a default ChaosError', async () => {
  const chaos = createChaos({ rng: seededRng(1), failRate: 1 });
  const fn = chaos.wrap(() => 'ok');
  await assert.rejects(fn(), (err) => err instanceof ChaosError && err.name === 'ChaosError');
});

test('throws errors from errorTypes, using each type', async () => {
  const chaos = createChaos({ rng: seededRng(7), failRate: 1, errorTypes: [NetError, DiskError] });
  const fn = chaos.wrap(() => 'ok');
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    try { await fn(); } catch (err) { seen.add(err.constructor); }
  }
  assert.deepEqual(seen, new Set([NetError, DiskError]));
});

test('seeded failures are reproducible and near failRate', async () => {
  const run = async () => {
    const fn = createChaos({ rng: seededRng(99), failRate: 0.3 }).wrap(() => 1);
    const out = [];
    for (let i = 0; i < 1000; i++) out.push(await fn().then(() => 0, () => 1));
    return out;
  };
  const a = await run();
  assert.deepEqual(a, await run());
  const rate = a.reduce((s, x) => s + x, 0) / a.length;
  assert.ok(rate > 0.25 && rate < 0.35, `rate ${rate}`);
});

test('latency uses the injected sleep, with no real waiting', async () => {
  const sleeps = [];
  const chaos = createChaos({ rng: () => 0.99, failRate: 0.5, latencyMs: 250, sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(await chaos.wrap(() => 'ok')(), 'ok');
  assert.deepEqual(sleeps, [250]);
});

test('no sleep when latencyMs is 0', async () => {
  const chaos = createChaos({ failRate: 0, sleep: () => assert.fail('should not sleep') });
  await chaos.wrap(() => 1)();
});

test('rejects invalid options', () => {
  assert.throws(() => createChaos({ failRate: 2 }), RangeError);
  assert.throws(() => createChaos({ latencyMs: -1 }), RangeError);
  assert.throws(() => createChaos({ errorTypes: [] }), TypeError);
});
