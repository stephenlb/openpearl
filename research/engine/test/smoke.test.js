import { test } from 'node:test';
import assert from 'node:assert/strict';

test('index module imports', async () => {
  const mod = await import('../src/index.js');
  assert.equal(typeof mod, 'object');
});
