// Multi-tenant store with row-level security.
// Callers never name a tenant: every read and write takes a session issued by
// core, and the session decides which rows are visible. A cross-tenant query
// cannot be expressed, so an extension bug cannot become a cross-tenant leak.
import { randomUUID } from 'node:crypto';

export const RESERVED = new Set(['id', 'tenant', 'owner']);
export const FIELD = /^[a-z][a-zA-Z0-9_]{0,63}$/;
export const scalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

export class AccessDenied extends Error {
  constructor(message) {
    super(message);
    this.name = 'AccessDenied';
  }
}

// policies: { [collection]: { visibility: 'tenant' | 'owner' } }
// 'tenant': every user of the tenant can read. 'owner': only the row owner and tenant admins.
export function createStore(policies) {
  const sessions = new WeakMap();
  const rows = new Map(); // collection -> row[]
  const kv = new Map(); // `${tenant}\0${ns}\0${user}\0${key}` -> json string
  for (const name of Object.keys(policies)) rows.set(name, []);

  const ctx = (session) => {
    const s = sessions.get(session);
    if (!s) throw new AccessDenied('invalid session');
    return s;
  };
  const policy = (collection) => {
    if (typeof collection !== 'string' || !Object.hasOwn(policies, collection)) {
      throw new AccessDenied(`unknown collection: ${String(collection)}`);
    }
    return policies[collection];
  };
  const isAdmin = (s) => s.roles.includes('admin');
  const visible = (s, collection, row) =>
    row.tenant === s.tenant && (policy(collection).visibility === 'tenant' || row.owner === s.user || isAdmin(s));
  const plain = (value, what) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new AccessDenied(`${what} must be an object`);
    for (const k of Object.keys(value)) {
      if (RESERVED.has(k)) throw new AccessDenied(`${what} may not set reserved field: ${k}`);
      if (!FIELD.test(k)) throw new AccessDenied(`${what} has an invalid field name: ${k}`);
    }
    // Copy through JSON so no caller-owned object or prototype is stored
    return JSON.parse(JSON.stringify(value));
  };
  const view = ({ tenant, ...row }) => structuredClone(row);

  return {
    session({ tenant, user, roles = [] }) {
      const session = Object.freeze({});
      sessions.set(session, Object.freeze({ tenant, user, roles: Object.freeze([...roles]) }));
      return session;
    },
    // Core-only: the runtime routes by the session's tenant, never by the URL.
    tenantOf(session) {
      return ctx(session).tenant;
    },
    whoami(session) {
      const { user, roles } = ctx(session);
      return { id: user, roles: [...roles] };
    },
    // Equality filter on non-reserved fields (plus `id` and `owner`), ANDed with row-level security.
    find(session, collection, filter = {}) {
      const s = ctx(session);
      policy(collection);
      if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) throw new AccessDenied('filter must be an object');
      for (const k of Object.keys(filter)) {
        if (k === 'tenant') throw new AccessDenied('filter may not set reserved field: tenant');
        if (k !== 'id' && k !== 'owner' && !FIELD.test(k)) throw new AccessDenied(`filter has an invalid field name: ${k}`);
        if (!scalar(filter[k])) throw new AccessDenied('filter values must be strings, numbers, booleans or null');
      }
      return rows.get(collection)
        .filter((row) => visible(s, collection, row) && Object.entries(filter).every(([k, v]) => row[k] === v))
        .map(view);
    },
    insert(session, collection, doc) {
      const s = ctx(session);
      policy(collection);
      const row = { ...plain(doc, 'document'), id: randomUUID(), tenant: s.tenant, owner: s.user };
      rows.get(collection).push(row);
      return view(row);
    },
    update(session, collection, id, patch) {
      const s = ctx(session);
      policy(collection);
      const row = rows.get(collection).find((r) => r.id === id && visible(s, collection, r));
      if (!row) throw new AccessDenied(`no such ${collection} row: ${String(id)}`);
      if (row.owner !== s.user && !isAdmin(s)) throw new AccessDenied('only the owner or an admin may update a row');
      Object.assign(row, plain(patch, 'patch'));
      return view(row);
    },
    // Key-value storage is scoped per tenant, extension namespace and user, so it
    // cannot carry one user's data to another.
    kvGet(session, ns, key) {
      const s = ctx(session);
      const v = kv.get(`${s.tenant}\0${ns}\0${s.user}\0${key}`);
      return v === undefined ? null : JSON.parse(v);
    },
    kvSet(session, ns, key, value) {
      const s = ctx(session);
      kv.set(`${s.tenant}\0${ns}\0${s.user}\0${key}`, JSON.stringify(value ?? null));
    },
    // Core-only: seed rows for any tenant (fixtures, migrations). Never exposed to extensions.
    seed(tenant, collection, owner, doc) {
      policy(collection);
      const row = { ...structuredClone(doc), id: doc.id ?? randomUUID(), tenant, owner };
      rows.get(collection).push(row);
      return row;
    },
  };
}
