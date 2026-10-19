// Runs extension invocations in worker threads: a separate V8 isolate per
// worker with a hard memory limit, terminated and replaced if it misbehaves.
//
//   const exec = createExecutor();
//   const res = await exec.run({ source, method, path, req, ops });  // ops: async (op, argsJson) => resultJson
//   await exec.close();
import { Worker } from 'node:worker_threads';
import { LIMITS } from './sandbox.js';

const BUFFER_BYTES = 4 << 20;

export function createExecutor({ size = 2, memoryMb = 64, timeoutMs = LIMITS.timeoutMs, callTimeoutMs = 5000 } = {}) {
  const encoder = new TextEncoder();
  const slots = [];
  const queue = [];
  let closed = false;

  const spawn = () => {
    const shared = new SharedArrayBuffer(8 + BUFFER_BYTES);
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
      workerData: { shared, callTimeoutMs },
      resourceLimits: { maxOldGenerationSizeMb: memoryMb, maxYoungGenerationSizeMb: Math.max(4, memoryMb >> 2), stackSizeMb: 4 },
      env: {}, // no environment (and so no secrets) inside the isolate
      stdout: true,
      stderr: true,
    });
    const slot = { worker, shared, state: new Int32Array(shared, 0, 2), bytes: new Uint8Array(shared, 8), job: null, timer: null };
    const reply = (json) => {
      let data = encoder.encode(json);
      if (data.length > BUFFER_BYTES) data = encoder.encode(JSON.stringify({ error: 'platform response too large' }));
      slot.bytes.set(data);
      Atomics.store(slot.state, 1, data.length);
      Atomics.store(slot.state, 0, 1);
      Atomics.notify(slot.state, 0);
    };
    worker.on('message', async (msg) => {
      const job = slot.job;
      if (!job) return;
      if (msg.type === 'call') {
        let out;
        try {
          out = await job.ops(msg.op, msg.args);
        } catch {
          out = JSON.stringify({ error: 'internal error' });
        }
        if (slot.job === job) reply(typeof out === 'string' ? out : JSON.stringify({ error: 'internal error' }));
      } else if (msg.type === 'done' && msg.id === job.id) {
        finish(slot, msg.result);
      }
    });
    // Out of memory, crash or termination: fail the job and replace the worker
    worker.on('exit', () => {
      const i = slots.indexOf(slot);
      if (i >= 0) slots.splice(i, 1);
      if (slot.job) finish(slot, { status: 500, body: { error: slot.killed ?? 'extension exceeded its memory limit' } });
      if (!closed) {
        slots.push(spawn());
        pump();
      }
    });
    worker.on('error', () => {});
    return slot;
  };

  const finish = (slot, result) => {
    const job = slot.job;
    slot.job = null;
    clearTimeout(slot.timer);
    job.resolve(result);
    pump();
  };

  const pump = () => {
    for (const slot of slots) {
      if (slot.job || !queue.length) continue;
      const job = queue.shift();
      slot.job = job;
      slot.killed = null;
      // The in-isolate timeout covers extension code; this covers everything else (stuck platform calls, hangs)
      slot.timer = setTimeout(() => {
        slot.killed = 'extension timed out';
        slot.worker.terminate();
      }, timeoutMs * 3 + callTimeoutMs);
      slot.worker.postMessage({ id: job.id, source: job.source, method: job.method, path: job.path, req: job.req, timeoutMs });
    }
  };

  for (let i = 0; i < size; i++) slots.push(spawn());
  let next = 0;
  return {
    run({ source, method, path, req, ops }) {
      if (closed) return Promise.resolve({ status: 503, body: { error: 'executor closed' } });
      return new Promise((resolve) => {
        queue.push({ id: ++next, source, method, path, req: JSON.parse(JSON.stringify(req ?? {})), ops, resolve });
        pump();
      });
    },
    async close() {
      closed = true;
      await Promise.all(slots.map((s) => s.worker.terminate()));
    },
  };
}
