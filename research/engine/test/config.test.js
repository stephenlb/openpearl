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

test('undefined values fall back to defaults', () => {
  assert.deepEqual(loadConfig({ retries: undefined }), DEFAULTS);
});

test('rejects unknown keys', () => {
  assert.throws(() => loadConfig({ timeoutMS: 5 }), /timeoutMS: unknown option/);
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
  assert.throws(() => loadConfig(new Date()), /plain object/);
  assert.throws(() => loadConfig(new Map()), /plain object/);
});

test('rejects inherited property names as unknown keys', () => {
  assert.throws(() => loadConfig({ constructor: 1 }), /constructor: unknown option/);
  assert.throws(() => loadConfig(JSON.parse('{"__proto__": {"x": 1}}')), /__proto__: unknown option/);
});

test('enforces range boundaries', () => {
  assert.equal(loadConfig({ retries: 100 }).retries, 100);
  assert.throws(() => loadConfig({ retries: 101 }), /retries/);
  assert.throws(() => loadConfig({ timeoutMs: 0 }), /timeoutMs/);
});

test('rejects null, numeric strings and Infinity', () => {
  for (const v of [null, '5', Infinity, -Infinity]) {
    assert.throws(() => loadConfig({ retries: v }), /retries: must be a finite number/);
  }
});
