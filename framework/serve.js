#!/usr/bin/env node
// Reference host: serves the extensions in the local registry over HTTP.
//   <METHOD> /ext/<slug><route path>          the live version (watched by deploy/monitor.js after each release)
//   <METHOD> /preview/ext/<slug><route path>  the version awaiting approval; tenant admins only, read-only data
//   POST /feedback/<slug> {"ok": false}       user feedback; repeated "not ok" rolls a new release back
//   Authorization: Bearer <token> on every request
// OPENPEARL_SERVE_TOKENS = {"<sha256 of token>": {"tenant": "...", "user": "...", "roles": []}}
// OPENPEARL_VERIFY_KEY (or OPENPEARL_VERIFY_KEY_FILE) = Ed25519 public key (PEM) that bundles must be signed with.
// OPENPEARL_DATABASE_URL (optional) = Postgres for tenant data, as the openpearl_app role; in-memory otherwise.
// OPENPEARL_SEED (optional) = JSON file of [{ tenant, collection, owner, doc }] rows.
// A file named `disabled` in a registry entry is a kill switch for that extension.
// OPENPEARL_ALERT_URL (optional) receives alert events as JSON POSTs.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStore, AccessDenied } from './core/store.js';
import { createMonitor } from '../deploy/monitor.js';
import { createRuntime } from './runtime/runtime.js';
import { installRejectionGuard } from './runtime/sandbox.js';
import { loadJson } from './core/extension.js';
import { localAdapter } from '../deploy/adapters/local.js';
import { SLUG } from './core/manifest.js';

const root = process.env.OPENPEARL_REGISTRY_DIR || '.openpearl-registry';
const tokens = JSON.parse(process.env.OPENPEARL_SERVE_TOKENS || '{}');
const policies = loadJson(new URL('./core/policies.json', import.meta.url));
const entitlements = loadJson(new URL('./core/entitlements.json', import.meta.url));
// OPENPEARL_DATABASE_URL selects the Postgres store (connect as openpearl_app); otherwise in-memory
let store;
if (process.env.OPENPEARL_DATABASE_URL) {
  const { default: pg } = await import('pg');
  const { createPostgresStore } = await import('./core/postgres.js');
  store = createPostgresStore({ pool: new pg.Pool({ connectionString: process.env.OPENPEARL_DATABASE_URL }), policies });
} else {
  store = createStore(policies);
}
for (const r of process.env.OPENPEARL_SEED ? JSON.parse(readFileSync(process.env.OPENPEARL_SEED, 'utf8')) : []) await store.seed(r.tenant, r.collection, r.owner, r.doc);
const registry = localAdapter({ root });
const publicKey = process.env.OPENPEARL_VERIFY_KEY_FILE ? readFileSync(process.env.OPENPEARL_VERIFY_KEY_FILE, 'utf8') : process.env.OPENPEARL_VERIFY_KEY;
const alert = (event) => {
  console.error(`ALERT ${JSON.stringify(event)}`);
  // Optional webhook for paging; best effort
  if (process.env.OPENPEARL_ALERT_URL) {
    fetch(process.env.OPENPEARL_ALERT_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) }).catch(() => {});
  }
};
const runtime = createRuntime({ store, policies, entitlements, publicKey, onAlert: (a) => alert({ type: 'capability-denied', tenant: a.tenant, slug: a.slug, commit: a.commit, reason: a.denied[0].reason }) });
// Previews run against the tenant's real data but can't write to it
const previewRuntime = createRuntime({ store: readOnly(store), policies, entitlements, publicKey });
const monitor = createMonitor({
  windowMs: Number(process.env.OPENPEARL_WATCH_SECONDS || 600) * 1000,
  minRequests: Number(process.env.OPENPEARL_WATCH_MIN_REQUESTS || 10),
  maxErrorRate: Number(process.env.OPENPEARL_WATCH_MAX_ERROR_RATE || 0.2),
});
const live = new Map(); // tenant/slug -> sha256 installed
const preview = new Map(); // tenant/slug -> sha256 installed in the preview runtime
const bad = new Map(); // tenant/slug -> Set of sha256 rolled back by the monitor
installRejectionGuard(() => console.error('unhandled rejection inside an extension'));

function readOnly(inner) {
  const deny = async () => {
    throw new AccessDenied('writes are disabled in preview');
  };
  return { ...inner, insert: deny, update: deny, kvSet: deny };
}

// The newest live version that the monitor hasn't rolled back
function serving(tenant, slug) {
  const skip = bad.get(`${tenant}/${slug}`) ?? new Set();
  const sha = registry.history(tenant, slug).filter((h) => !skip.has(h)).at(-1);
  return sha ? registry.get(tenant, slug, sha) : null;
}

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size <= 1 << 20) chunks.push(c);
    });
    req.on('end', () => {
      if (size > 1 << 20) return resolve({ error: 'body too large' });
      try {
        resolve({ body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null });
      } catch {
        resolve({ error: 'body must be JSON' });
      }
    });
  });

const install = (rt, installed, key, bundle) => {
  if (installed.get(key) === bundle.sha256) return true;
  try {
    rt.install(bundle);
    installed.set(key, bundle.sha256);
    return true;
  } catch (e) {
    console.error(`refusing bundle ${key}: ${e.message}`);
    return false;
  }
};

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') return send(res, 200, { status: 'ok' });
  const m = /^Bearer ([\x21-\x7e]{16,512})$/.exec(req.headers.authorization ?? '');
  const who = m && tokens[createHash('sha256').update(m[1]).digest('hex')];
  if (!who) return send(res, 401, { error: 'unauthorized' });
  const url = new URL(req.url, 'http://host');
  const route = /^\/(ext|preview\/ext|feedback)\/([a-z][a-z0-9-]{1,38})(\/.*)?$/.exec(url.pathname);
  if (!route || !SLUG.test(route[2])) return send(res, 404, { error: 'not found' });
  const [, kind, slug, path = '/'] = route;
  const key = `${who.tenant}/${slug}`;
  if (existsSync(join(root, who.tenant, slug, 'disabled'))) return send(res, 503, { error: 'extension disabled' });
  const { body, error } = await readBody(req);
  if (error) return send(res, 400, { error });
  const session = store.session({ tenant: who.tenant, user: who.user, roles: who.roles ?? [] });

  if (kind === 'preview/ext') {
    // Only tenant admins try previews; they approve through the intake service
    if (!(who.roles ?? []).includes('admin')) return send(res, 403, { error: 'previews are for tenant admins' });
    const sha = registry.previewSha(who.tenant, slug);
    const bundle = sha && registry.get(who.tenant, slug, sha);
    if (!bundle || bundle.tenant !== who.tenant || bundle.slug !== slug) return send(res, 404, { error: 'no preview' });
    if (!install(previewRuntime, preview, key, bundle)) return send(res, 503, { error: 'preview unavailable' });
    previewRuntime.enable(who.tenant, slug);
    const out = await previewRuntime.handle({ session, slug, method: req.method, path, query: Object.fromEntries(url.searchParams), body });
    return send(res, out.status, out.body);
  }

  const bundle = serving(who.tenant, slug);
  if (!bundle) return send(res, 404, { error: 'not found' });
  if (bundle.tenant !== who.tenant || bundle.slug !== slug) return send(res, 503, { error: 'extension unavailable' });
  if (!install(runtime, live, key, bundle)) return send(res, 503, { error: 'extension unavailable' });
  monitor.track(key, bundle.sha256);
  const rollback = (decision) => {
    if (decision.action !== 'rollback') return;
    bad.set(key, new Set([...(bad.get(key) ?? []), decision.sha]));
    // The previous version takes over on the next request
    runtime.enable(who.tenant, slug);
    live.delete(key);
    alert({ type: 'rolled-back', tenant: who.tenant, slug, sha256: decision.sha, reason: decision.reason });
  };

  if (kind === 'feedback') {
    // POST /feedback/<slug> { "ok": false } : "this didn't do what I asked"
    if (req.method !== 'POST' || typeof body?.ok !== 'boolean') return send(res, 400, { error: 'POST { "ok": true | false }' });
    console.log(`feedback ${key}@${bundle.sha256.slice(0, 12)} from ${who.user}: ${body.ok ? 'ok' : 'not ok'}`);
    rollback(monitor.feedback(key, bundle.sha256, body.ok));
    return send(res, 202, { recorded: true });
  }

  const out = await runtime.handle({ session, slug, method: req.method, path, query: Object.fromEntries(url.searchParams), body });
  rollback(monitor.record(key, bundle.sha256, { status: out.status, denied: out.audit.denied.length }));
  send(res, out.status, out.body);
}).listen(Number(process.env.PORT) || 8788, () => console.log(`extension host listening on :${Number(process.env.PORT) || 8788}`));
