import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCheckpointStore, resumeJobs } from '../src/index.js';

test('resumes unfinished jobs, skips done/unknown, reports failures', async () => {
  const s = createCheckpointStore();
  s.save('a', { type: 'copy', step: 2 });
  s.save('b', { type: 'copy', done: true });
  s.save('c', { type: 'mystery' });
  s.save('d', { type: 'bad' });
  const seen = [];
  const boom = new Error('boom');
  const r = await resumeJobs(s, {
    copy: async (st, key) => { seen.push([key, st.step]); },
    bad: () => { throw boom; },
  });
  assert.deepEqual(seen, [['a', 2]]);
  assert.deepEqual(r, { resumed: ['a'], failed: [{ key: 'd', error: boom }], skipped: ['b', 'c'] });
  assert.equal(s.load('a'), undefined);
  assert.ok(s.load('d'));
  assert.ok(s.load('c'));
});

test('simulated crash mid-job: second process resumes from file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-recover-'));
  const file = path.join(dir, 'ckpt.json');
  try {
    const s1 = createCheckpointStore({ path: file });
    s1.save('job1', { type: 'sum', i: 3, acc: 6 });
    // crash: process dies before the job finishes or clears its checkpoint
    const s2 = createCheckpointStore({ path: file });
    let result;
    const r = await resumeJobs(s2, {
      sum: (st) => { result = st.acc + st.i; },
    });
    assert.equal(result, 9);
    assert.deepEqual(r.resumed, ['job1']);
    assert.equal(createCheckpointStore({ path: file }).load('job1'), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('failed job is retried on the next run', async () => {
  const s = createCheckpointStore();
  s.save('j', { type: 't' });
  let n = 0;
  const handlers = { t: () => { if (++n === 1) throw new Error('crash'); } };
  assert.equal((await resumeJobs(s, handlers)).failed.length, 1);
  assert.deepEqual((await resumeJobs(s, handlers)).resumed, ['j']);
});

test('inherited handler names are ignored; bad args throw', async () => {
  const s = createCheckpointStore();
  s.save('j', { type: 'toString' });
  assert.deepEqual((await resumeJobs(s, {})).skipped, ['j']);
  await assert.rejects(resumeJobs({}, {}), TypeError);
  await assert.rejects(resumeJobs(s, null), TypeError);
});
