import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateRegressionTest } from '../src/index.js';

// A nested --test run must not inherit the parent runner's context.
const childEnv = { ...process.env, NODE_TEST_CONTEXT: undefined };

const event = {
  id: 'f1',
  task: 'sync',
  error: { name: 'TypeError', message: 'bad "quote"\nline `tick` $' + '{x}', code: 'E_BAD' },
  input: { a: [1, 2] },
};

test('output is deterministic and embeds the failure', () => {
  const src = generateRegressionTest(event);
  assert.equal(src, generateRegressionTest(event));
  assert.match(src, /E_BAD/);
  assert.match(src, /from 'node:test'/);
});

test('output parses and fails until reproduce() is implemented', () => {
  const dir = mkdtempSync(join(tmpdir(), 'regress-'));
  try {
    const file = join(dir, 'gen.test.js');
    writeFileSync(file, generateRegressionTest(event));
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
    const run = spawnSync(process.execPath, ['--test', file], { encoding: 'utf8', env: childEnv });
    assert.notEqual(run.status, 0);
    assert.match(run.stdout + run.stderr, /reproduce\(\) not implemented/);
    const filled = readFileSync(file, 'utf8').replace(
      'throw NOT_IMPLEMENTED;',
      'throw Object.assign(new TypeError(expected.message), { code: expected.code });',
    );
    writeFileSync(file, filled);
    const ok = spawnSync(process.execPath, ['--test', file], { encoding: 'utf8', env: childEnv });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('minimal events and invalid input', () => {
  const src = generateRegressionTest({});
  assert.match(src, /regression: task Error/);
  assert.throws(() => generateRegressionTest(null), TypeError);
  assert.throws(() => generateRegressionTest({ error: { message: {} } }), TypeError);
});
