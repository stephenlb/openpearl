import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, DEFAULTS } from '../src/index.js';

test('returns defaults for empty input', () => {
  assert.deepEqual(loadConfig({}), DEFAULTS);
  assert.deepEqual(loadConfig(), DEFAULTS);
});

test('overrides merge over defaults', () => {
  const c = loadConfig({ retries: 0, concurrency: 8 });
  assert.equal(c.retries, 0);
  assert.equal(c.concurrency, 8);
  assert.equal(c.timeoutMs, DEFAULTS.timeoutMs);
});

test('does not mutate input or defaults', () => {
  const input = { retries: 1 };
  loadConfig(input);
  assert.deepEqual(input, { retries: 1 });
  assert.equal(DEFAULTS.retries, 3);
});

test('lists all invalid fields', () => {
  assert.throws(
    () => loadConfig({ retries: -1, timeoutMs: 'x', concurrency: 1.5, cacheTtlMs: NaN }),
    (e) => ['retries', 'timeoutMs', 'concurrency', 'cacheTtlMs'].every((k) => e.message.includes(k)),
  );
});

test('only reports invalid fields', () => {
  assert.throws(
    () => loadConfig({ concurrency: 0 }),
    (e) => e.message.includes('concurrency') && !e.message.includes('retries'),
  );
});

test('rejects non-object input', () => {
  assert.throws(() => loadConfig(null), /plain object/);
  assert.throws(() => loadConfig([]), /plain object/);
});
