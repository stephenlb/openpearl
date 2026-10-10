import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateRegressionTest } from '../src/index.js';

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

test('output parses and the generated test passes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'regress-'));
  try {
    const file = join(dir, 'gen.test.js');
    writeFileSync(file, generateRegressionTest(event));
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
    const run = spawnSync(process.execPath, ['--test', file], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('minimal events and invalid input', () => {
  const src = generateRegressionTest({});
  assert.match(src, /regression: task Error/);
  assert.throws(() => generateRegressionTest(null), TypeError);
});
