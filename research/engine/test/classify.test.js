import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyError, TimeoutError } from '../src/index.js';

function make(props, message = '') {
  return Object.assign(new Error(message), props);
}

const cases = [
  ['ECONNRESET code', make({ code: 'ECONNRESET' }), 'transient', true],
  ['ECONNREFUSED code', make({ code: 'ECONNREFUSED' }), 'transient', true],
  ['EPIPE code', make({ code: 'EPIPE' }), 'transient', true],
  ['EAI_AGAIN code', make({ code: 'EAI_AGAIN' }), 'transient', true],
  ['lowercase code', make({ code: 'econnreset' }), 'transient', true],
  ['ETIMEDOUT code', make({ code: 'ETIMEDOUT' }), 'timeout', true],
  ['ESOCKETTIMEDOUT code', make({ code: 'ESOCKETTIMEDOUT' }), 'timeout', true],
  ['TimeoutError instance', new TimeoutError(50), 'timeout', true],
  ['TimeoutError by name', make({ name: 'TimeoutError' }, 'x'), 'timeout', true],
  ['timeout in message', new Error('request timed out'), 'timeout', true],
  ['AbortError with timeout message', make({ name: 'AbortError' }, 'The operation timed out'), 'timeout', true],
  ['plain AbortError', make({ name: 'AbortError' }, 'aborted'), 'unknown', false],
  ['ENOMEM code', make({ code: 'ENOMEM' }), 'resource', true],
  ['EMFILE code', make({ code: 'EMFILE' }), 'resource', true],
  ['ENOSPC code', make({ code: 'ENOSPC' }), 'resource', true],
  ['out of memory message', new Error('JavaScript heap out of memory'), 'resource', true],
  ['RangeError out of memory', new RangeError('Array buffer allocation failed: out of memory'), 'resource', true],
  ['EACCES code', make({ code: 'EACCES' }), 'permanent', false],
  ['EPERM code', make({ code: 'EPERM' }), 'permanent', false],
  ['ENOENT code', make({ code: 'ENOENT' }), 'permanent', false],
  ['ENOTFOUND code', make({ code: 'ENOTFOUND' }), 'permanent', false],
  ['TypeError', new TypeError('x is not a function'), 'permanent', false],
  ['SyntaxError', new SyntaxError('Unexpected token'), 'permanent', false],
  ['permission denied message', new Error('permission denied'), 'permanent', false],
  ['socket hang up message', new Error('socket hang up'), 'transient', true],
  ['rate limit message', new Error('Rate limit exceeded'), 'transient', true],
  ['code beats message', make({ code: 'EACCES' }, 'timed out'), 'permanent', false],
  ['unrecognised error', new Error('something odd'), 'unknown', false],
  ['unrecognised code', make({ code: 'EWHATEVER' }, 'odd'), 'unknown', false],
  ['string input', 'connection reset by peer', 'transient', true],
  ['null', null, 'unknown', false],
  ['undefined', undefined, 'unknown', false],
  ['non-string code', { code: 42, message: 'odd' }, 'unknown', false],
];

for (const [label, err, klass, retryable] of cases) {
  test(`classifyError: ${label}`, () => {
    assert.deepEqual(classifyError(err), { class: klass, retryable });
  });
}

test('classifyError returns a fresh object each call', () => {
  const a = classifyError(new Error('x'));
  a.retryable = true;
  assert.equal(classifyError(new Error('x')).retryable, false);
});
