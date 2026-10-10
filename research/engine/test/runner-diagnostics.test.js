import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTask } from '../src/index.js';

test('always-throwing fn is reported as failure with diagnostics, not faked success', async () => {
  const res = await runTask(() => { throw new Error('boom'); }, { retries: 2, sleep: () => {} });
  assert.equal(res.ok, false);
  assert.equal(res.attempts, 3);
  assert.equal(res.diagnostics.reason, 'exhausted');
  assert.equal(res.diagnostics.maxAttempts, 3);
  assert.deepEqual(res.diagnostics.errors.map((e) => e.attempt), [1, 2, 3]);
  assert.equal(res.diagnostics.errors[0].message, 'boom');
  assert.equal(res.diagnostics.errors[0].name, 'Error');
});

test('permanent error stops early and is labelled', async () => {
  const res = await runTask(() => { throw Object.assign(new Error('nope'), { code: 'EACCES' }); }, { retries: 5, sleep: () => {} });
  assert.equal(res.ok, false);
  assert.equal(res.attempts, 1);
  assert.equal(res.diagnostics.reason, 'permanent');
  assert.equal(res.diagnostics.errors[0].class, 'permanent');
  assert.equal(res.diagnostics.errors[0].retryable, false);
});

test('non-object throws are summarised', async () => {
  const res = await runTask(() => { throw 'str'; }, { retries: 0 });
  assert.equal(res.ok, false);
  assert.equal(res.diagnostics.errors[0].message, 'str');
  assert.equal(res.diagnostics.errors[0].name, 'string');
});

test('success results carry no diagnostics', async () => {
  const res = await runTask(() => 1);
  assert.deepEqual(res, { ok: true, value: 1, attempts: 1 });
});
