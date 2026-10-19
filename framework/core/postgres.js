// Postgres store with the same interface as store.js (methods return promises).
// Tenant and user scoping is enforced by row-level security in the database
// (postgres.sql); the queries below deliberately don't filter by tenant, so a
// bug here can't widen access. Connect as openpearl_app, never as a superuser
// or the table owner, both of which bypass RLS.
import { AccessDenied, RESERVED, FIELD, scalar } from './store.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// pool: a pg.Pool (or anything with connect() -> client { query, release })
export function createPostgresStore({ pool, policies }) {
  const sessions = new WeakMap();
  const ctx = (session) => {
    const s = sessions.get(session);
    if (!s) throw new AccessDenied('invalid session');
    return s;
  };
  const policy = (collection) => {
    if (typeof collection !== 'string' || !Object.hasOwn(policies, collection)) throw new AccessDenied(`unknown collection: ${String(collection)}`);
  };
  const plain = (value, what) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new AccessDenied(`${what} must be an object`);
    for (const k of Object.keys(value)) {
      if (RESERVED.has(k)) throw new AccessDenied(`${what} may not set reserved field: ${k}`);
      if (!FIELD.test(k)) throw new AccessDenied(`${what} has an invalid field name: ${k}`);
    }
    return JSON.stringify(value);
  };
  // Every statement runs in a transaction scoped to one tenant, user and role
  const scoped = async ({ tenant, user, admin }, fn) => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        "select set_config('openpearl.tenant', $1, true), set_config('openpearl.user', $2, true), set_config('openpearl.admin', $3, true)",
        [tenant, user, admin ? 'true' : 'false'],
      );
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  };
  const as = (s) => ({ tenant: s.tenant, user: s.user, admin: s.roles.includes('admin') });
  const view = (r) => ({ ...r.doc, id: r.id, owner: r.owner });

  return {
    session({ tenant, user, roles = [] }) {
      const session = Object.freeze({});
      sessions.set(session, Object.freeze({ tenant, user, roles: Object.freeze([...roles]) }));
      return session;
    },
    tenantOf: (session) => ctx(session).tenant,
    whoami(session) {
      const { user, roles } = ctx(session);
      return { id: user, roles: [...roles] };
    },
    async find(session, collection, filter = {}) {
      const s = ctx(session);
      policy(collection);
      if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) throw new AccessDenied('filter must be an object');
      const where = ['collection = $1'];
      const params = [collection];
      const doc = {};
      for (const [k, v] of Object.entries(filter)) {
        if (k === 'tenant') throw new AccessDenied('filter may not set reserved field: tenant');
        if (k !== 'id' && k !== 'owner' && !FIELD.test(k)) throw new AccessDenied(`filter has an invalid field name: ${k}`);
        if (!scalar(v)) throw new AccessDenied('filter values must be strings, numbers, booleans or null');
        if (k === 'id') {
          if (typeof v !== 'string' || !UUID.test(v)) return [];
          params.push(v);
          where.push(`id = $${params.length}`);
        } else if (k === 'owner') {
          params.push(v);
          where.push(`owner = $${params.length}`);
        } else {
          doc[k] = v;
        }
      }
      if (Object.keys(doc).length) {
        params.push(JSON.stringify(doc));
        where.push(`doc @> $${params.length}::jsonb`);
      }
      return scoped(as(s), async (c) => (await c.query(`select id, owner, doc from openpearl_rows where ${where.join(' and ')} order by id`, params)).rows.map(view));
    },
    async insert(session, collection, doc) {
      const s = ctx(session);
      policy(collection);
      const json = plain(doc, 'document');
      return scoped(as(s), async (c) =>
        view((await c.query('insert into openpearl_rows (collection, tenant, owner, doc) values ($1, $2, $3, $4::jsonb) returning id, owner, doc', [collection, s.tenant, s.user, json])).rows[0]));
    },
    async update(session, collection, id, patch) {
      const s = ctx(session);
      policy(collection);
      const json = plain(patch, 'patch');
      return scoped(as(s), async (c) => {
        if (typeof id !== 'string' || !UUID.test(id)) throw new AccessDenied(`no such ${collection} row: ${String(id)}`);
        const res = await c.query('update openpearl_rows set doc = doc || $3::jsonb where id = $1 and collection = $2 returning id, owner, doc', [id, collection, json]);
        if (res.rows.length) return view(res.rows[0]);
        const seen = await c.query('select 1 from openpearl_rows where id = $1 and collection = $2', [id, collection]);
        throw new AccessDenied(seen.rows.length ? 'only the owner or an admin may update a row' : `no such ${collection} row: ${id}`);
      });
    },
    async kvGet(session, ns, key) {
      const s = ctx(session);
      return scoped(as(s), async (c) => {
        const r = await c.query('select value from openpearl_kv where tenant = $1 and ns = $2 and owner = $3 and key = $4', [s.tenant, ns, s.user, key]);
        return r.rows.length ? r.rows[0].value : null;
      });
    },
    async kvSet(session, ns, key, value) {
      const s = ctx(session);
      await scoped(as(s), (c) =>
        c.query('insert into openpearl_kv (tenant, ns, owner, key, value) values ($1, $2, $3, $4, $5::jsonb) on conflict (tenant, ns, owner, key) do update set value = excluded.value',
          [s.tenant, ns, s.user, key, JSON.stringify(value ?? null)]));
    },
    // Core-only: insert a row for any tenant and owner (fixtures, migrations)
    async seed(tenant, collection, owner, doc) {
      policy(collection);
      const { id, ...rest } = doc;
      return scoped({ tenant, user: owner, admin: false }, async (c) => {
        const r = await c.query('insert into openpearl_rows (id, collection, tenant, owner, doc) values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5::jsonb) returning id',
          [id ?? null, collection, tenant, owner, JSON.stringify(rest)]);
        return { ...rest, id: r.rows[0].id, tenant, owner };
      });
    },
  };
}
