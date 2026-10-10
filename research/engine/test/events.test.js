import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventLog } from '../src/events.js';

function setup(opts = {}) {
  let t = 0;
  const log = createEventLog({ now: () => t, ...opts });
  return { log, tick: (ms) => { t += ms; } };
}

test('emit records type, data, time and sequence', () => {
  const { log, tick } = setup();
  tick(5);
  assert.deepEqual(log.emit('a', { x: 1 }), { seq: 0, t: 5, type: 'a', data: { x: 1 } });
  assert.equal(log.emit('b').seq, 1);
});

test('emit validates type', () => {
  assert.throws(() => setup().log.emit(''), TypeError);
});

test('query filters by type and since', () => {
  const { log, tick } = setup();
  log.emit('a'); tick(10); log.emit('b'); tick(10); log.emit('a');
  assert.equal(log.query().length, 3);
  assert.deepEqual(log.query({ type: 'a' }).map((e) => e.t), [0, 20]);
  assert.deepEqual(log.query({ since: 10 }).map((e) => e.type), ['b', 'a']);
  assert.deepEqual(log.query({ type: 'a', since: 10 }).map((e) => e.t), [20]);
});

test('ring buffer drops oldest beyond cap', () => {
  const { log } = setup({ cap: 2 });
  log.emit('a'); log.emit('b'); log.emit('c');
  assert.deepEqual(log.query().map((e) => e.type), ['b', 'c']);
  assert.equal(log.size(), 2);
});

test('invalid cap throws', () => {
  assert.throws(() => createEventLog({ cap: 0 }), RangeError);
});

test('JSONL round trip', () => {
  const { log, tick } = setup();
  log.emit('a', { x: 1 }); tick(3); log.emit('b', { y: [2] });
  const str = log.toJSONL();
  assert.equal(str.split('\n').length, 2);
  const other = setup().log;
  assert.equal(other.fromJSONL(str + '\n\n'), 2);
  const strip = ({ t, type, data }) => ({ t, type, data });
  assert.deepEqual(other.query().map(strip), log.query().map(strip));
});

test('fromJSONL rejects bad input and respects cap', () => {
  const { log } = setup({ cap: 1 });
  assert.throws(() => log.fromJSONL('{nope'), SyntaxError);
  assert.throws(() => log.fromJSONL('{"type":"a"}'), TypeError);
  log.fromJSONL('{"t":1,"type":"a"}\n{"t":2,"type":"b"}');
  assert.deepEqual(log.query().map((e) => e.type), ['b']);
});

test('empty log serializes to empty string', () => {
  assert.equal(setup().log.toJSONL(), '');
});
