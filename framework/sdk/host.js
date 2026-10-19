// Host side of the capability SDK: the only path from an extension to data.
// Every call is checked against the manifest's capabilities, scoped by the
// caller's session in the store, and recorded in the audit trail.
import { AccessDenied } from '../core/store.js';
import { sensitiveFields } from '../core/manifest.js';

const MAX_LOG = 2000;
const MAX_LOGS = 100;
const KEY = /^[a-zA-Z0-9:_.-]{1,128}$/;

// The code reached past its manifest. Distinct from store errors, which user
// input can trigger (unknown row, reserved field) and which are only rejected.
export class CapabilityDenied extends AccessDenied {}

// audit: { events: [], logs: [], denied: [], rejected: [] } collected for one invocation.
export function createHostCall({ store, session, manifest, audit, policies = {} }) {
  const caps = new Set(manifest.capabilities);
  const routes = new Set(manifest.routes.map((r) => `${r.method} ${r.path}`));
  const ns = manifest.name;
  const roles = store.whoami(session).roles;
  // Sensitive values handed to the extension in this invocation; logs never carry them
  const seen = new Set();
  // A sensitive field reaches the extension only with its field capability and, if the
  // policy lists roles, only for callers with one of those roles.
  const mask = (collection, rows) => {
    const fields = Object.entries(sensitiveFields(policies, collection));
    return rows.map((row) => {
      for (const [field, rule] of fields) {
        if (!Object.hasOwn(row, field)) continue;
        const allowed = caps.has(`data:read:${collection}.${field}`) && (!rule.roles || rule.roles.some((r) => roles.includes(r)));
        if (allowed && row[field] !== null && row[field] !== undefined) seen.add(String(row[field]));
        if (!allowed) delete row[field];
      }
      return row;
    });
  };
  const writable = (collection, doc) => {
    if (doc === null || typeof doc !== 'object') return;
    for (const field of Object.keys(sensitiveFields(policies, collection))) {
      if (Object.hasOwn(doc, field)) need(`data:write:${collection}.${field}`);
    }
  };
  const need = (cap) => {
    if (!caps.has(cap)) throw new CapabilityDenied(`capability not declared in manifest: ${cap}`);
  };
  const str = (v, what) => {
    if (typeof v !== 'string') throw new AccessDenied(`${what} must be a string`);
    return v;
  };
  const ops = {
    route([method, path]) {
      if (!routes.has(`${method} ${path}`)) throw new CapabilityDenied(`route not declared in manifest: ${method} ${path}`);
      return null;
    },
    async 'data.find'([collection, filter]) {
      need(`data:read:${str(collection, 'collection')}`);
      return mask(collection, await store.find(session, collection, filter));
    },
    async 'data.insert'([collection, doc]) {
      need(`data:write:${str(collection, 'collection')}`);
      writable(collection, doc);
      return mask(collection, [await store.insert(session, collection, doc)])[0];
    },
    async 'data.update'([collection, id, patch]) {
      need(`data:write:${str(collection, 'collection')}`);
      writable(collection, patch);
      return mask(collection, [await store.update(session, collection, str(id, 'id'), patch)])[0];
    },
    async 'kv.get'([key]) {
      need('kv:read');
      if (!KEY.test(str(key, 'key'))) throw new AccessDenied('invalid kv key');
      return await store.kvGet(session, ns, key);
    },
    async 'kv.set'([key, value]) {
      need('kv:write');
      if (!KEY.test(str(key, 'key'))) throw new AccessDenied('invalid kv key');
      await store.kvSet(session, ns, key, value);
      return null;
    },
    log([message]) {
      need('log');
      if (audit.logs.length >= MAX_LOGS) throw new AccessDenied('log limit reached');
      let text = str(message, 'log message').slice(0, MAX_LOG);
      for (const v of seen) {
        if (v.length >= 3 && text.includes(v)) {
          text = text.split(v).join('[redacted]');
          audit.redactions = (audit.redactions ?? 0) + 1;
        }
      }
      audit.logs.push(text);
      return null;
    },
  };
  // Async so stores can be remote (Postgres); the executor keeps the extension side synchronous
  return async (op, argsJson) => {
    if (!Object.hasOwn(ops, op)) return JSON.stringify({ error: `unknown operation: ${op}` });
    let args;
    try {
      args = JSON.parse(argsJson);
      if (!Array.isArray(args)) throw new Error();
    } catch {
      return JSON.stringify({ error: 'invalid arguments' });
    }
    try {
      const value = await ops[op](args);
      audit.events.push({ op, ok: true });
      return JSON.stringify({ value: value ?? null });
    } catch (e) {
      if (!(e instanceof AccessDenied)) throw e;
      audit.events.push({ op, ok: false });
      (e instanceof CapabilityDenied ? audit.denied : audit.rejected).push({ op, reason: e.message });
      return JSON.stringify({ error: e.message });
    }
  };
}
