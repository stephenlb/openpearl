import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfiler } from '../src/index.js';

function clock() {
  let t = 0;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

test('empty report has no bottleneck', () => {
  const p = createProfiler({ now: clock().now });
  assert.deepEqual(p.report(), { totalMs: 0, stages: [], bottleneck: null });
});

test('accumulates time per stage and sorts by percent', () => {
  const c = clock();
  const p = createProfiler({ now: c.now });
  assert.equal(p.stage('parse', () => { c.advance(10); return 'ok'; }), 'ok');
  p.stage('run', () => c.advance(60));
  p.stage('parse', () => c.advance(10));
  p.stage('write', () => c.advance(20));
  const r = p.report();
  assert.equal(r.totalMs, 100);
  assert.equal(r.bottleneck, 'run');
  assert.deepEqual(
    r.stages.map((s) => [s.name, s.percent, s.calls]),
    [['run', 60, 1], ['parse', 20, 2], ['write', 20, 1]],
  );
});

test('records time when fn throws', () => {
  const c = clock();
  const p = createProfiler({ now: c.now });
  assert.throws(() => p.stage('bad', () => { c.advance(5); throw new Error('x'); }), /x/);
  assert.equal(p.report().stages[0].totalMs, 5);
});

test('async stages are timed and rejections propagate', async () => {
  const c = clock();
  const p = createProfiler({ now: c.now });
  assert.equal(await p.stage('io', async () => { c.advance(7); return 1; }), 1);
  await assert.rejects(p.stage('io', async () => { c.advance(3); throw new Error('no'); }), /no/);
  const r = p.report();
  assert.equal(r.stages[0].totalMs, 10);
  assert.equal(r.stages[0].calls, 2);
});

test('zero total time yields 0 percent; reset clears', () => {
  const p = createProfiler({ now: clock().now });
  p.stage('a', () => {});
  assert.equal(p.report().stages[0].percent, 0);
  p.reset();
  assert.equal(p.report().bottleneck, null);
});

test('validates arguments', () => {
  const p = createProfiler({ now: clock().now });
  assert.throws(() => p.stage('', () => {}), TypeError);
  assert.throws(() => p.stage('a', 1), TypeError);
  assert.throws(() => createProfiler({ now: 1 }), TypeError);
});
