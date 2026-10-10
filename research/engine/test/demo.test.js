import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadScenarios } from '../src/index.js';

const DEMO = fileURLToPath(new URL('../examples/demo.js', import.meta.url));

test('demo exits 0 and prints one row per scenario', () => {
  const r = spawnSync(process.execPath, [DEMO], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  const names = loadScenarios().map((s) => s.name);
  const rows = lines.filter((l) => names.includes(l.split(/\s+/)[0]));
  assert.equal(rows.length, names.length);
  assert.equal(lines.length, names.length + 2); // header + rule + rows
});
