import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScenarios, getScenario, validateScenario, validateScenarios } from '../src/index.js';

const BIN = fileURLToPath(new URL('../bin/pearl.js', import.meta.url));
const pearl = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
const good = () => ({ name: 'x', failRate: 0.1, latencySpikes: { probability: 0, ms: 0 }, corruptStateRate: 0 });

test('shipped file has 12 valid unique scenarios', () => {
  const list = loadScenarios();
  assert.equal(list.length, 12);
  assert.equal(new Set(list.map((s) => s.name)).size, 12);
});

test('failRates span 0.05..0.6 and include spikes and corruption', () => {
  const list = loadScenarios();
  const rates = list.map((s) => s.failRate);
  assert.equal(Math.min(...rates), 0.05);
  assert.equal(Math.max(...rates), 0.6);
  assert.ok(list.some((s) => s.latencySpikes.probability > 0));
  assert.ok(list.some((s) => s.corruptStateRate > 0));
});

test('getScenario finds by name and throws on unknown', () => {
  assert.equal(getScenario('heavy-60').failRate, 0.6);
  assert.throws(() => getScenario('nope'), /Unknown scenario/);
});

test('validation rejects bad entries', () => {
  assert.doesNotThrow(() => validateScenario(good()));
  assert.throws(() => validateScenario(null), /object/);
  assert.throws(() => validateScenario({ ...good(), name: '' }), /name/);
  assert.throws(() => validateScenario({ ...good(), failRate: 1.5 }), /failRate/);
  assert.throws(() => validateScenario({ ...good(), latencySpikes: undefined }), /latencySpikes/);
  assert.throws(() => validateScenario({ ...good(), latencySpikes: { probability: 2, ms: 1 } }), /probability/);
  assert.throws(() => validateScenario({ ...good(), latencySpikes: { probability: 0, ms: -1 } }), /ms/);
  assert.throws(() => validateScenario({ ...good(), corruptStateRate: -0.1 }), /corruptStateRate/);
  assert.throws(() => validateScenarios([]), /non-empty/);
  assert.throws(() => validateScenarios([good(), good()]), /duplicate/);
});

test('loadScenarios rejects malformed, keyless, and missing files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scenarios-'));
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{not json');
  assert.throws(() => loadScenarios(bad), SyntaxError);
  const keyless = join(dir, 'keyless.json');
  writeFileSync(keyless, '{}');
  assert.throws(() => loadScenarios(keyless), /non-empty array/);
  assert.throws(() => loadScenarios(join(dir, 'missing.json')), /ENOENT/);
});

test('cli scenarios lists and fetches one', () => {
  const all = pearl('scenarios');
  assert.equal(all.status, 0);
  assert.equal(JSON.parse(all.stdout).length, 12);
  const one = pearl('scenarios', 'heavy-60');
  assert.equal(JSON.parse(one.stdout).name, 'heavy-60');
  assert.equal(pearl('scenarios', 'nope').status, 1);
  assert.equal(pearl('scenarios', 'a', 'b').status, 2);
});
