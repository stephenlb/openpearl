// Regression test generator: turns a failure event into the source text of a
// `node:test` file. The event is `{ id?, task?, error: { name?, message?,
// code? }, input? }`. All values are embedded as JSON literals, so the output
// is deterministic and safe against quotes/newlines in messages.
function lit(v) {
  return JSON.stringify(v ?? null);
}

export function generateRegressionTest(failureEvent) {
  if (!failureEvent || typeof failureEvent !== 'object') {
    throw new TypeError('failureEvent must be an object');
  }
  const { id, task, input } = failureEvent;
  const err = failureEvent.error ?? {};
  const expected = {
    name: err.name ?? 'Error',
    message: err.message ?? '',
    code: err.code ?? null,
  };
  const title = `regression: ${task ?? 'task'} ${id ?? expected.code ?? expected.name}`;
  return `import { test } from 'node:test';
import assert from 'node:assert/strict';

const input = ${lit(input)};
const expected = ${lit(expected)};

// Replace with a call into the code under test; it must reject or throw.
async function reproduce(input) {
  throw Object.assign(new Error(expected.message), { name: expected.name, code: expected.code ?? undefined });
}

test(${lit(title)}, async () => {
  await assert.rejects(() => reproduce(input), (err) => {
    assert.equal(err.name, expected.name);
    assert.equal(err.message, expected.message);
    if (expected.code !== null) assert.equal(err.code, expected.code);
    return true;
  });
});
`;
}
