import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMonitor } from '../../deploy/monitor.js';

test('rolls back on a capability denial', () => {
  const m = createMonitor();
  m.track('acme/x', 'v2');
  assert.equal(m.record('acme/x', 'v2', { status: 200 }).action, 'none');
  assert.deepEqual(m.record('acme/x', 'v2', { status: 500, denied: 1 }), { action: 'rollback', sha: 'v2', reason: 'capability denied' });
  // Tripped once; later traffic doesn't trip again
  assert.equal(m.record('acme/x', 'v2', { status: 500, denied: 1 }).action, 'none');
});

test('rolls back on a high error rate only after enough requests', () => {
  const m = createMonitor({ minRequests: 5, maxErrorRate: 0.4 });
  m.track('k', 'v');
  for (let i = 0; i < 3; i++) assert.equal(m.record('k', 'v', { status: 500 }).action, 'none');
  assert.equal(m.record('k', 'v', { status: 200 }).action, 'none');
  assert.equal(m.record('k', 'v', { status: 200 }).action, 'rollback');
});

test('rolls back on repeated negative feedback, and stops watching after the window', () => {
  let t = 0;
  const m = createMonitor({ windowMs: 1000, maxNegativeFeedback: 2, now: () => t });
  m.track('k', 'v');
  assert.equal(m.feedback('k', 'v', true).action, 'none');
  assert.equal(m.feedback('k', 'v', false).action, 'none');
  assert.equal(m.feedback('k', 'v', false).action, 'rollback');
  m.track('k', 'v3');
  t = 2000;
  assert.equal(m.record('k', 'v3', { status: 500, denied: 1 }).action, 'none');
});

test('outcomes for a different version are ignored', () => {
  const m = createMonitor();
  m.track('k', 'v2');
  assert.equal(m.record('k', 'v1', { status: 500, denied: 1 }).action, 'none');
});
