import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/pearl.js', import.meta.url));
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

test('config with extra arguments exits 2', () => {
  assert.equal(pearl('config', '{}', '{}').status, 2);
});

test('config with non-object JSON exits 1', () => {
  for (const input of ['null', '[]', '5']) assert.equal(pearl('config', input).status, 1, input);
});

test('config with unknown key exits 1', () => {
  const r = pearl('config', '{"bogus":1}');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /bogus: unknown option/);
});

test('config reports multiple errors at once', () => {
  const r = pearl('config', '{"retries":-1,"concurrency":0}');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /retries/);
  assert.match(r.stderr, /concurrency/);
});

test('importing the module does not run the CLI', async () => {
  const mod = await import('../bin/pearl.js');
  assert.deepEqual(mod.run(['health']), { code: 0, out: '{"status":"ok"}' });
  assert.equal(process.exitCode, undefined);
});

test('usage errors exit 2', () => {
  assert.equal(pearl().status, 2);
  assert.equal(pearl('bogus').status, 2);
  assert.equal(pearl('config').status, 2);
});
