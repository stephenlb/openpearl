// Runs one extension invocation in a fresh V8 context.
//
// Only strings cross the boundary: the extension sees an `openpearl` object built
// inside its own context, whose functions close over a host callback that the
// extension cannot reach. Host objects (and so the host `Function`) never enter
// the context, and string code generation is disabled.
//
// node:vm is a reference sandbox, not a hardened one: it has no memory limit
// and shares the host process. Production adapters should run the same
// contract in a separate isolate (workerd, isolated-vm) or process.
import vm from 'node:vm';
import { types } from 'node:util';

export const LIMITS = Object.freeze({ timeoutMs: 1000, sourceBytes: 200_000, messageBytes: 65_536 });

// Dynamic import() rejects with a host-realm error, which is an escape; the
// keyword cannot be written with escapes, so a token check is sufficient.
const FORBIDDEN = /\bimport\b/;

const BRIDGE = `(function (hostCall) {
  'use strict';
  const parse = JSON.parse, stringify = JSON.stringify, freeze = Object.freeze;
  const call = (op, args) => {
    const json = stringify(args);
    let raw;
    // Anything thrown by the host side (even a stack overflow inside it) is
    // host-realm; replace it without ever binding it where extension code can reach.
    try { raw = hostCall(op, json); } catch { throw new Error('internal error'); }
    if (typeof raw !== 'string') throw new Error('internal error');
    const r = parse(raw);
    if (r.error !== undefined) throw new Error(r.error);
    return r.value;
  };
  const routes = new Map();
  let pending = null;
  const openpearl = freeze({
    route(method, path, handler) {
      if (typeof handler !== 'function') throw new TypeError('route handler must be a function');
      call('route', [method, path]);
      routes.set(method + ' ' + path, handler);
    },
    data: freeze({
      find: (collection, filter) => call('data.find', [collection, filter === undefined ? {} : filter]),
      insert: (collection, doc) => call('data.insert', [collection, doc]),
      update: (collection, id, patch) => call('data.update', [collection, id, patch]),
    }),
    kv: freeze({
      get: (key) => call('kv.get', [key]),
      set: (key, value) => call('kv.set', [key, value]),
    }),
    log: (...parts) => { call('log', [parts.map((p) => typeof p === 'string' ? p : stringify(p)).join(' ')]); },
  });
  const run = () => {
    const { key, req } = pending;
    pending = null;
    const handler = routes.get(key);
    if (!handler) return stringify({ status: 404, body: { error: 'no such route' } });
    try {
      const out = handler(parse(req));
      if (out !== null && (typeof out === 'object' || typeof out === 'function') && typeof out.then === 'function') {
        return stringify({ status: 500, body: { error: 'handlers must return a value, not a promise' } });
      }
      return stringify({ status: 200, body: out === undefined ? null : out });
    } catch (e) {
      return stringify({ status: 500, body: { error: String(e && e.message !== undefined ? e.message : e) } });
    }
  };
  Object.defineProperty(globalThis, 'openpearl', { value: openpearl });
  Object.defineProperty(globalThis, '__openpearl_run', { value: run });
  return (key, req) => { pending = { key, req }; };
})`;

export function checkSource(source) {
  if (typeof source !== 'string') return 'extension source must be a string';
  if (Buffer.byteLength(source) > LIMITS.sourceBytes) return `extension source exceeds ${LIMITS.sourceBytes} bytes`;
  if (FORBIDDEN.test(source)) return 'extension source may not use import';
  return null;
}

// hostCall(op, argsJson) -> resultJson must only ever return strings.
// Returns { status, body } where body is parsed from a string produced in the context.
export function invoke({ source, hostCall, method, path, req, timeoutMs = LIMITS.timeoutMs }) {
  const bad = checkSource(source);
  if (bad) return { status: 500, body: { error: bad } };
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: 'afterEvaluate',
  });
  const opts = { timeout: timeoutMs };
  const guarded = (op, args) => {
    try {
      if (typeof op !== 'string' || typeof args !== 'string') return JSON.stringify({ error: 'invalid call' });
      if (args.length > LIMITS.messageBytes) return JSON.stringify({ error: 'call arguments too large' });
      const out = hostCall(op, args);
      return typeof out === 'string' ? out : JSON.stringify({ error: 'internal error' });
    } catch {
      // Never let a host error object into the context
      return JSON.stringify({ error: 'internal error' });
    }
  };
  try {
    const setPending = new vm.Script(BRIDGE).runInContext(context, opts)(guarded);
    new vm.Script(source, { filename: 'extension.js' }).runInContext(context, opts);
    setPending(`${method} ${path}`, JSON.stringify(req ?? {}));
    const out = new vm.Script('__openpearl_run()').runInContext(context, opts);
    if (typeof out !== 'string' || out.length > LIMITS.messageBytes * 16) return { status: 500, body: { error: 'invalid response' } };
    return JSON.parse(out);
  } catch (e) {
    return { status: 500, body: { error: safeMessage(e) } };
  }
}

// The thrown value may be a context object with getters or a proxy; reading it
// normally would run extension code outside the timeout. Read only own data properties.
function safeMessage(e) {
  if (e === null || typeof e !== 'object' || types.isProxy(e)) return 'extension failed';
  const d = Object.getOwnPropertyDescriptor(e, 'message');
  return d && typeof d.value === 'string' ? d.value.slice(0, 500) : 'extension failed';
}

// Promise rejections inside a context are reported to the host process, and
// Node's default turns them into a crash. Hosts that run extensions call this
// once; it never inspects the (untrusted) rejection reason.
let guarded = false;
export function installRejectionGuard(onRejection = () => {}) {
  if (guarded) return;
  guarded = true;
  process.on('unhandledRejection', () => onRejection());
}
