import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BIN = new URL('../bin/pearl.js', import.meta.url).pathname;
const pearl = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });

test('version prints package version', () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const r = pearl('version');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), version);
});

test('health reports ok', () => {
  const r = pearl('health');
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { status: 'ok' });
});

test('config merges defaults', () => {
  const r = pearl('config', '{"retries":5}');
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).retries, 5);
  assert.equal(JSON.parse(r.stdout).concurrency, 4);
});

test('config with invalid values exits 1', () => {
  const r = pearl('config', '{"retries":-1}');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /retries/);
});

test('config with malformed JSON exits 1', () => {
  assert.equal(pearl('config', '{nope').status, 1);
});

test('usage errors exit 2', () => {
  assert.equal(pearl().status, 2);
  assert.equal(pearl('bogus').status, 2);
  assert.equal(pearl('config').status, 2);
});
