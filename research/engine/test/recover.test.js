import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCheckpointStore, resumeJobs } from '../src/index.js';

test('resumes unfinished jobs and clears them', async () => {
  const store = createCheckpointStore();
  store.save('a', { handler: 'copy', step: 2 });
  store.save('b', { handler: 'copy', done: true });
  const seen = [];
  const r = await resumeJobs(store, { copy: (s, k) => { seen.push([k, s.step]); } });
  assert.deepEqual(r, { resumed: ['a'], failed: [], skipped: [] });
  assert.deepEqual(seen, [['a', 2]]);
  assert.equal(store.load('a'), undefined);
  assert.deepEqual(store.load('b'), { handler: 'copy', done: true });
});

test('failed handlers keep checkpoint; unknown handlers are skipped', async () => {
  const store = createCheckpointStore();
  store.save('a', { handler: 'boom' });
  store.save('b', { handler: 'nope' });
  store.save('c', { handler: 'ok' });
  const err = new Error('x');
  const r = await resumeJobs(store, { boom: () => { throw err; }, ok: async () => {} });
  assert.deepEqual(r, { resumed: ['c'], failed: [{ key: 'a', error: err }], skipped: ['b'] });
  assert.ok(store.load('a') && store.load('b'));
});

test('simulated crash mid-job then recovery from file', async () => {
  const files = new Map();
  const fs = {
    readFileSync(p) {
      if (!files.has(p)) throw Object.assign(new Error('nf'), { code: 'ENOENT' });
      return files.get(p);
    },
    writeFileSync(p, t) { files.set(p, t); },
    renameSync(a, b) { files.set(b, files.get(a)); files.delete(a); },
    mkdirSync() {},
  };
  const store1 = createCheckpointStore({ path: '/tmp/cp.json', fs });
  store1.save('job1', { handler: 'work', step: 1 });
  // crash: the process dies mid-job; a fresh store reopens the same file
  const store2 = createCheckpointStore({ path: '/tmp/cp.json', fs });
  let ran = 0;
  const handlers = { work: (s) => { ran += s.step; } };
  assert.deepEqual((await resumeJobs(store2, handlers)).resumed, ['job1']);
  assert.equal(ran, 1);
  const store3 = createCheckpointStore({ path: '/tmp/cp.json', fs });
  assert.deepEqual(await resumeJobs(store3, handlers), { resumed: [], failed: [], skipped: [] });
});

test('rejects invalid store', async () => {
  await assert.rejects(resumeJobs({}, {}), TypeError);
});
