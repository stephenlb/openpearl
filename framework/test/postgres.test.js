// Runs against a throwaway local Postgres cluster (initdb/pg_ctl on PATH), or
// OPENPEARL_TEST_ADMIN_DATABASE_URL if set. Skipped when neither is available.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
let pg;
try {
  pg = (await import('pg')).default;
} catch {
  pg = null;
}
const external = process.env.OPENPEARL_TEST_ADMIN_DATABASE_URL;
const skip = !pg ? 'pg is not installed' : !external && !(has('initdb') && has('pg_ctl')) ? 'no Postgres available' : false;

let dir;
let adminUrl;
let appUrl;
let pool;
let createPostgresStore;
let AccessDenied;
const policies = JSON.parse(readFileSync(new URL('../core/policies.json', import.meta.url)));

before(async () => {
  if (skip) return;
  if (external) {
    adminUrl = external;
  } else {
    dir = mkdtempSync(join(tmpdir(), 'openpearl-pg-'));
    execFileSync('initdb', ['-D', join(dir, 'data'), '-U', 'postgres', '--auth=trust', '-E', 'UTF8'], { stdio: 'ignore' });
    execFileSync('pg_ctl', ['-D', join(dir, 'data'), '-o', `-k ${dir} -c listen_addresses='' -p 5432`, '-l', join(dir, 'log'), '-w', 'start'], { stdio: 'ignore' });
    adminUrl = `postgres://postgres@localhost/postgres?host=${encodeURIComponent(dir)}`;
  }
  execFileSync(process.execPath, ['framework/migrate.js', '--app-password', 'app-pw'], { cwd: repoRoot, env: { ...process.env, OPENPEARL_ADMIN_DATABASE_URL: adminUrl }, stdio: 'pipe' });
  const u = new URL(adminUrl);
  u.username = 'openpearl_app';
  u.password = 'app-pw';
  appUrl = u.toString();
  pool = new pg.Pool({ connectionString: appUrl, max: 4 });
  ({ createPostgresStore } = await import('../core/postgres.js'));
  ({ AccessDenied } = await import('../core/store.js'));
  // Each test file run starts clean
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query('truncate openpearl_rows, openpearl_kv');
  await admin.end();
});

after(async () => {
  await pool?.end();
  if (dir) {
    spawnSync('pg_ctl', ['-D', join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('row-level security scopes reads by tenant, owner and role', { skip }, async () => {
  const store = createPostgresStore({ pool, policies });
  await store.seed('t-one', 'orders', 'alice', { amount: 1, secret: 'ONE-ORDER' });
  await store.seed('t-two', 'orders', 'eve', { amount: 2, secret: 'TWO-ORDER' });
  await store.seed('t-one', 'notes', 'bob', { secret: 'BOB-NOTE' });
  const alice = store.session({ tenant: 't-one', user: 'alice' });
  const bob = store.session({ tenant: 't-one', user: 'bob' });
  const admin = store.session({ tenant: 't-one', user: 'root', roles: ['admin'] });
  assert.deepEqual((await store.find(alice, 'orders')).map((r) => r.secret), ['ONE-ORDER']);
  assert.deepEqual(await store.find(alice, 'notes'), []);
  assert.deepEqual((await store.find(bob, 'notes')).map((r) => r.secret), ['BOB-NOTE']);
  assert.equal((await store.find(admin, 'notes')).length, 1);
  assert.deepEqual((await store.find(alice, 'orders', { amount: 1 })).length, 1);
  await assert.rejects(store.find(alice, 'orders', { tenant: 't-two' }), AccessDenied);
  await assert.rejects(store.find(alice, 'orders', { amount: { $gt: 0 } }), /filter values/);
});

test('writes stay in the caller tenant and only owners or admins update', { skip }, async () => {
  const store = createPostgresStore({ pool, policies });
  const alice = store.session({ tenant: 't-w', user: 'alice' });
  const bob = store.session({ tenant: 't-w', user: 'bob' });
  const other = store.session({ tenant: 't-x', user: 'mallory' });
  const row = await store.insert(alice, 'orders', { amount: 5 });
  assert.equal(row.owner, 'alice');
  await assert.rejects(store.update(bob, 'orders', row.id, { amount: 6 }), /owner or an admin/);
  await assert.rejects(store.update(other, 'orders', row.id, { amount: 7 }), /no such orders row/);
  assert.equal((await store.update(alice, 'orders', row.id, { amount: 8 })).amount, 8);
  await assert.rejects(store.insert(alice, 'orders', { tenant: 't-x' }), /reserved field/);
});

test('kv is scoped per tenant, extension and user', { skip }, async () => {
  const store = createPostgresStore({ pool, policies });
  const a = store.session({ tenant: 't-kv', user: 'alice' });
  const b = store.session({ tenant: 't-kv', user: 'bob' });
  await store.kvSet(a, 'ext', 'k', { v: 1 });
  assert.deepEqual(await store.kvGet(a, 'ext', 'k'), { v: 1 });
  assert.equal(await store.kvGet(b, 'ext', 'k'), null);
  assert.equal(await store.kvGet(a, 'other-ext', 'k'), null);
});

test('the app role sees nothing without a scope and cannot move rows between tenants', { skip }, async () => {
  const client = await pool.connect();
  try {
    assert.equal((await client.query('select count(*)::int as n from openpearl_rows')).rows[0].n, 0);
    await assert.rejects(client.query("update openpearl_rows set tenant = 'x'"), /permission denied/);
    await assert.rejects(client.query('delete from openpearl_rows'), /permission denied/);
    await assert.rejects(client.query('alter table openpearl_rows disable row level security'), /must be owner/);
  } finally {
    client.release();
  }
});

test('the isolation corpus gives the same verdicts on Postgres', { skip }, async () => {
  const { runIsolation } = await import('../../isolation/harness.js');
  const { loadJson } = await import('../core/extension.js');
  const entitlements = loadJson(new URL('../core/entitlements.json', import.meta.url));
  const root = new URL('../../evals/corpus/extensions/', import.meta.url);
  for (const [name, tenant, expected] of [['benign-order-summary', 'acme', 'pass'], ['attack-launder-notes', 'acme', 'fail'], ['benign-my-notes', 'beta', 'pass']]) {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query('truncate openpearl_rows, openpearl_kv');
    await admin.end();
    const spec = loadJson(new URL(`${name}/case.json`, root));
    const extension = {
      slug: spec.slug,
      manifest: loadJson(new URL(`${name}/ext/manifest.json`, root)),
      source: readFileSync(new URL(`${name}/ext/index.js`, root), 'utf8'),
    };
    const report = await runIsolation({ tenant, extension, policies, entitlements, store: createPostgresStore({ pool, policies }) });
    assert.equal(report.status, expected, `${name}: ${JSON.stringify(report.violations.slice(0, 2))}`);
  }
});
