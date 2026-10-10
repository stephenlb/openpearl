import { test } from 'node:test';
import assert from 'node:assert/strict';

test('chaos drill: intentional failure', () => {
  assert.equal(1, 2);
});
