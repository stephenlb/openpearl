// Worker-thread side of the executor. Each worker is its own V8 isolate with a
// memory cap; every invocation still gets a fresh vm context (sandbox.js).
// Calls into the platform block on a shared buffer while the main thread runs
// the (possibly async) data operation, so extensions keep a synchronous API.
import { parentPort, workerData } from 'node:worker_threads';
import { invoke, installRejectionGuard } from './sandbox.js';

const state = new Int32Array(workerData.shared, 0, 2); // [0] = ready flag, [1] = byte length
const bytes = new Uint8Array(workerData.shared, 8);
const decoder = new TextDecoder();
installRejectionGuard();

const hostCall = (op, args) => {
  Atomics.store(state, 0, 0);
  parentPort.postMessage({ type: 'call', op, args });
  if (Atomics.wait(state, 0, 0, workerData.callTimeoutMs) === 'timed-out') return JSON.stringify({ error: 'platform call timed out' });
  return decoder.decode(bytes.slice(0, Atomics.load(state, 1)));
};

parentPort.on('message', (msg) => {
  const result = invoke({ source: msg.source, hostCall, method: msg.method, path: msg.path, req: msg.req, timeoutMs: msg.timeoutMs });
  parentPort.postMessage({ type: 'done', id: msg.id, result });
});
