import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairJSONL, repairCheckpoint } from '../src/index.js';

test('repairJSONL keeps valid input untouched', () => {
  const text = '{"a":1}\n{"b":2}\n';
  assert.deepEqual(repairJSONL(text), { repaired: text, dropped: [] });
});

test('repairJSONL drops malformed and truncated lines with line numbers', () => {
  const r = repairJSONL('{"a":1}\n{"b":\nnot json\n{"c":3}\n{"d"');
  assert.equal(r.repaired, '{"a":1}\n{"c":3}\n');
  assert.deepEqual(r.dropped.map((d) => d.line), [2, 3, 5]);
  assert.ok(r.dropped.every((d) => typeof d.reason === 'string' && d.reason));
});

test('repairJSONL skips blank lines and handles CRLF', () => {
  const r = repairJSONL('{"a":1}\r\n\r\n   \r\n{"b":2}');
  assert.equal(r.repaired, '{"a":1}\n{"b":2}\n');
  assert.deepEqual(r.dropped, []);
});

test('repairJSONL on empty/all-bad input', () => {
  assert.deepEqual(repairJSONL(''), { repaired: '', dropped: [] });
  assert.equal(repairJSONL('x\ny').repaired, '');
  assert.throws(() => repairJSONL(null), TypeError);
});

test('repairCheckpoint fills missing and null fields from defaults', () => {
  const schema = { step: 0, items: [], meta: { v: 1 } };
  const input = { step: 5, items: null, extra: true };
  const out = repairCheckpoint(input, schema);
  assert.deepEqual(out, { step: 5, items: [], meta: { v: 1 }, extra: true });
  assert.deepEqual(input, { step: 5, items: null, extra: true });
});

test('repairCheckpoint keeps falsy present values and clones defaults', () => {
  const schema = { n: 9, list: [] };
  const out = repairCheckpoint({ n: 0 }, schema);
  assert.equal(out.n, 0);
  out.list.push(1);
  assert.deepEqual(schema.list, []);
});

test('repairCheckpoint handles non-object state', () => {
  for (const bad of [null, undefined, 'x', 3, []]) {
    assert.deepEqual(repairCheckpoint(bad, { a: 1 }), { a: 1 });
  }
  assert.throws(() => repairCheckpoint({}, null), TypeError);
});
