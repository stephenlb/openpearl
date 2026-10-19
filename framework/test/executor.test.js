import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createExecutor } from '../runtime/executor.js';

const exec = createExecutor({ size: 1, memoryMb: 32, timeoutMs: 500 });
after(() => exec.close());
const run = (source, ops = async () => JSON.stringify({ value: null })) => exec.run({ source, method: 'GET', path: '/x', req: {}, ops });

test('platform calls can be async while the extension API stays synchronous', async () => {
  const ops = async (op, args) => {
    await new Promise((r) => setTimeout(r, 20));
    return JSON.stringify({ value: op === 'data.find' ? [{ n: JSON.parse(args)[0] }] : null });
  };
  const res = await run(`openpearl.route('GET', '/x', () => openpearl.data.find('orders')[0].n)`, ops);
  assert.deepEqual(res, { status: 200, body: 'orders' });
});

test('an extension that exhausts memory is killed and the worker is replaced', async () => {
  const res = await run(`openpearl.route('GET', '/x', () => { const a = []; for (;;) a.push(new Array(1e5).fill(7)); })`);
  assert.equal(res.status, 500);
  assert.match(res.body.error, /memory|timed out/);
  assert.deepEqual(await run(`openpearl.route('GET', '/x', () => 'still serving')`), { status: 200, body: 'still serving' });
});

test('a platform call that never answers fails instead of hanging', async () => {
  const quick = createExecutor({ size: 1, timeoutMs: 200, callTimeoutMs: 100 });
  try {
    const res = await quick.run({ source: `openpearl.route('GET', '/x', () => openpearl.data.find('orders'))`, method: 'GET', path: '/x', req: {}, ops: () => new Promise(() => {}) });
    assert.match(res.body.error, /timed out/);
  } finally {
    await quick.close();
  }
});

test('the worker isolate has no environment variables', async () => {
  process.env.OPENPEARL_TEST_SECRET = 'do-not-leak';
  const res = await run(`openpearl.route('GET', '/x', () => typeof process)`);
  assert.equal(res.body, 'undefined');
  delete process.env.OPENPEARL_TEST_SECRET;
});
