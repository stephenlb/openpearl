import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHealth } from '../src/health.js';

function clock() {
  let t = 0;
  return () => (t += 5);
}

test('no checks is ok', async () => {
  assert.deepEqual(await createHealth().run(), { status: 'ok', checks: {} });
});

test('all passing is ok with timings', async () => {
  const h = createHealth({ now: clock() });
  h.register('db', async () => true);
  const r = await h.run();
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.checks.db, { ok: true, ms: 5, error: null });
});

test('some failing is degraded', async () => {
  const h = createHealth({ now: clock() });
  h.register('a', () => {});
  h.register('b', () => { throw new Error('boom'); });
  const r = await h.run();
  assert.equal(r.status, 'degraded');
  assert.equal(r.checks.a.ok, true);
  assert.equal(r.checks.b.ok, false);
  assert.equal(r.checks.b.error, 'boom');
});

test('all failing is down; false return is a failure', async () => {
  const h = createHealth({ now: clock() });
  h.register('a', async () => false);
  h.register('b', async () => { throw 'x'; });
  const r = await h.run();
  assert.equal(r.status, 'down');
  assert.equal(r.checks.a.error, 'check returned false');
  assert.equal(r.checks.b.error, 'x');
});

test('register validates arguments', () => {
  const h = createHealth();
  assert.throws(() => h.register('', () => {}), TypeError);
  assert.throws(() => h.register('a', null), TypeError);
});
