import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftIssues, failureSignature } from '../src/index.js';

const ev = (message, extra = {}) => ({ name: 'IOError', message, ...extra });

test('groups by normalized signature and honors minCount', () => {
  const events = [
    ev('timeout after 30 ms', { task: 'b' }),
    ev('timeout after 45 ms', { task: 'a' }),
    ev('timeout after 7 ms'),
    ev('disk full'),
  ];
  const out = draftIssues(events);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, '[failure] IOError: timeout after <n> ms');
  assert.match(out[0].body, /3 times/);
  assert.match(out[0].body, /Affected tasks: a, b/);
  assert.deepEqual(out[0].labels, ['bug', 'self-heal']);
  assert.equal(draftIssues(events, { minCount: 1 }).length, 2);
});

test('deterministic regardless of input order', () => {
  const a = [ev('x'), ev('x'), ev('y'), ev('y'), ev('y')];
  const out = draftIssues(a, { minCount: 2 });
  assert.deepEqual(out.map((d) => d.title), ['[failure] IOError: y', '[failure] IOError: x']);
  assert.deepEqual(draftIssues([...a].reverse(), { minCount: 2 }), out);
});

test('example message is order-independent and cannot break out of its fence', () => {
  const a = [ev('t 3 ```x'), ev('t 1 ```x'), ev('t 2 ```x')];
  const out = draftIssues(a);
  assert.deepEqual(draftIssues([...a].reverse()), out);
  assert.match(out[0].body, /````\nt 1 ```x\n````/);
  assert.match(out[0].body, /Signature: `IOError: t <n> '''x`/);
});

test('truncates long titles and normalizes hex', () => {
  const long = 'e'.repeat(200);
  const [d] = draftIssues([ev(long), ev(long), ev(long)]);
  assert.equal(d.title.length, '[failure] '.length + 80);
  assert.ok(d.title.endsWith('…'));
  assert.equal(failureSignature(ev('at 0xDEADbeef')), 'IOError: at <hex>');
});

test('signature fallbacks and missing messages', () => {
  assert.equal(failureSignature({ code: 'E1', error: { message: 'boom 3' } }), 'E1: boom <n>');
  assert.equal(failureSignature({ error: 'str' }), 'Error: str');
  assert.equal(failureSignature({ error: {} }), 'Error');
  const [d] = draftIssues([{ task: null }, { task: null }, { task: null }]);
  assert.doesNotMatch(d.body, /Example message|Affected tasks/);
});

test('explicit signature wins and bad input throws', () => {
  assert.equal(failureSignature({ signature: 'sig-1', message: 'm' }), 'sig-1');
  assert.throws(() => draftIssues('nope'), TypeError);
  assert.throws(() => draftIssues([], { minCount: 0 }), RangeError);
  assert.deepEqual(draftIssues([]), []);
});
