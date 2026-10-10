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

test('explicit signature wins and bad input throws', () => {
  assert.equal(failureSignature({ signature: 'sig-1', message: 'm' }), 'sig-1');
  assert.throws(() => draftIssues('nope'), TypeError);
  assert.throws(() => draftIssues([], { minCount: 0 }), RangeError);
  assert.deepEqual(draftIssues([]), []);
});
