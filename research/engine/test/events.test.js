import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventLog } from '../src/index.js';

function setup(opts = {}) {
  let t = 100;
  const log = createEventLog({ now: () => t, ...opts });
  return { log, advance: (ms) => { t += ms; } };
}

test('emit records timestamp, type and data', () => {
  const { log } = setup();
  assert.deepEqual(log.emit('a', { x: 1 }), { ts: 100, type: 'a', data: { x: 1 } });
  assert.equal(log.size(), 1);
});

test('fromJSONL is atomic on malformed input and defaults data', () => {
  const { log } = setup();
  assert.throws(() => log.fromJSONL('{"ts":1,"type":"a"}\nnot json'));
  assert.equal(log.size(), 0);
  log.fromJSONL('{"ts":1,"type":"a"}');
  assert.deepEqual(log.query(), [{ ts: 1, type: 'a', data: {} }]);
});

test('invalid cap is rejected', () => {
  for (const cap of [0, -1, 1.5, NaN]) assert.throws(() => createEventLog({ cap }), RangeError);
});

test('query returns [] when nothing matches and results are isolated', () => {
  const { log } = setup();
  const d = { x: 1 };
  log.emit('a', d).data.x = 2;
  d.x = 3;
  assert.deepEqual(log.query({ type: 'zzz' }), []);
  assert.equal(log.query()[0].data.x, 1);
});

test('query filters by type and since', () => {
  const { log, advance } = setup();
  log.emit('a');
  advance(10);
  log.emit('b');
  advance(10);
  log.emit('a');
  assert.equal(log.query().length, 3);
  assert.equal(log.query({ type: 'a' }).length, 2);
  assert.equal(log.query({ since: 110 }).length, 2);
  assert.equal(log.query({ type: 'a', since: 110 }).length, 1);
});

test('ring buffer drops oldest beyond cap', () => {
  const { log } = setup({ cap: 2 });
  log.emit('a');
  log.emit('b');
  log.emit('c');
  assert.deepEqual(log.query().map((e) => e.type), ['b', 'c']);
});

test('fromJSONL rejects malformed events atomically', () => {
  const { log } = setup();
  for (const bad of ['5', '[]', '{}', 'null', '{"foo":1}', '{"ts":"1","type":"a"}', '{"ts":1,"type":2}']) {
    assert.throws(() => log.fromJSONL(`{"ts":1,"type":"a"}\n${bad}`), TypeError);
  }
  assert.equal(log.size(), 0);
});

test('JSONL round trip', () => {
  const { log, advance } = setup();
  log.emit('a', { x: 1 });
  advance(5);
  log.emit('b', { y: [2] });
  const str = log.toJSONL();
  assert.equal(str.split('\n').length, 2);
  const other = createEventLog();
  other.fromJSONL(str + '\n\n');
  assert.deepEqual(other.query(), log.query());
});

test('fromJSONL respects cap; empty log serialises to empty string', () => {
  const { log } = setup({ cap: 1 });
  assert.equal(log.toJSONL(), '');
  log.fromJSONL('{"ts":1,"type":"a","data":{}}\n{"ts":2,"type":"b","data":{}}');
  assert.deepEqual(log.query().map((e) => e.type), ['b']);
});
