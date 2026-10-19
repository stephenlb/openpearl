import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runSpecs, validateSpec, matches } from '../../isolation/spec.js';

const policies = JSON.parse(readFileSync(new URL('../core/policies.json', import.meta.url)));
const entitlements = JSON.parse(readFileSync(new URL('../core/entitlements.json', import.meta.url)));
const corpus = new URL('../../evals/corpus/extensions/benign-order-summary/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('ext/manifest.json', corpus)));
const spec = JSON.parse(readFileSync(new URL('spec.json', corpus)));

test('a spec catches an extension that is safe but wrong', async () => {
  const buggy = "openpearl.route('GET', '/summary', () => { const o = openpearl.data.find('orders'); return { count: o.length, total: o.length }; });";
  const report = await runSpecs({ tenant: 'acme', extension: { slug: 'order-summary', manifest, source: buggy }, specs: [spec], policies, entitlements });
  assert.equal(report.status, 'fail');
  assert.match(report.cases[0].problems[0], /does not match/);
});

test('specs must only call declared routes and use known personas and collections', () => {
  const bad = { version: 1, cases: [{ name: 'x', as: 'root', seed: [{ collection: 'secrets', owner: 'member', doc: {} }], request: { method: 'GET', path: '/admin' }, expect: {} }] };
  const errors = validateSpec(bad, manifest, policies).join('\n');
  assert.match(errors, /member, peer or admin/);
  assert.match(errors, /unknown collection/);
  assert.match(errors, /route in the manifest/);
});

test('subset matching ignores extra keys and array order', () => {
  assert.ok(matches({ a: 1, b: [{ x: 1, y: 2 }, { x: 3 }] }, { b: [{ x: 3 }, { x: 1 }] }, false));
  assert.ok(!matches({ a: 1 }, { a: 2 }, false));
  assert.ok(!matches([{ x: 1 }], [{ x: 1 }, { x: 1 }], false));
  assert.ok(matches({ a: [1, 2] }, { a: [1, 2] }, true));
});
