import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createStore } from '../core/store.js';
import { createRuntime } from '../runtime/runtime.js';
import { createBundle, signBundle } from '../core/bundle.js';
import { installRejectionGuard, invoke } from '../runtime/sandbox.js';

const policies = JSON.parse(readFileSync(new URL('../core/policies.json', import.meta.url)));
const entitlements = JSON.parse(readFileSync(new URL('../core/entitlements.json', import.meta.url)));
const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
installRejectionGuard();

const manifest = (capabilities, routes = [{ method: 'GET', path: '/x' }]) => ({
  version: 1, name: 'probe', description: 'test extension', routes, capabilities,
});

const runtimes = [];
after(() => Promise.all(runtimes.map((r) => r.close())));

function setup(source, capabilities = ['data:read:orders'], routes) {
  const store = createStore(policies);
  store.seed('acme', 'orders', 'alice', { total: 10, secret: 'ACME-ORDER' });
  store.seed('beta', 'orders', 'eve', { total: 99, secret: 'BETA-ORDER' });
  store.seed('acme', 'notes', 'bob', { secret: 'BOB-NOTE' });
  const alerts = [];
  const runtime = createRuntime({ store, policies, entitlements, publicKey, onAlert: (a) => alerts.push(a) });
  runtimes.push(runtime);
  runtime.install(signBundle(createBundle({ tenant: 'acme', slug: 'probe', manifest: manifest(capabilities, routes), source, commit: 'c1' }), privateKey));
  const as = (tenant, user, roles) => store.session({ tenant, user, roles });
  const call = (session, path = '/x', method = 'GET') => runtime.handle({ session, slug: 'probe', method, path });
  return { store, runtime, alerts, as, call };
}

test('extension reads only its own tenant rows', async () => {
  const { as, call } = setup(`openpearl.route('GET', '/x', () => openpearl.data.find('orders'))`);
  const res = await call(as('acme', 'alice'));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((r) => r.secret), ['ACME-ORDER']);
});

test('filters cannot name a tenant and owner-visible rows stay private', async () => {
  const { as, call } = setup(
    `openpearl.route('GET', '/x', () => { let t; try { openpearl.data.find('orders', { tenant: 'beta' }) } catch (e) { t = e.message } return { t, notes: openpearl.data.find('notes') } })`,
    ['data:read:orders', 'data:read:notes'],
  );
  const alice = (await call(as('acme', 'alice'))).body;
  assert.match(alice.t, /reserved field: tenant/);
  assert.deepEqual(alice.notes, []);
  assert.deepEqual((await call(as('acme', 'bob'))).body.notes.map((n) => n.secret), ['BOB-NOTE']);
  assert.equal((await call(as('acme', 'root', ['admin']))).body.notes.length, 1);
});

test('the same extension installed for one tenant is not reachable by another', async () => {
  const { as, call } = setup(`openpearl.route('GET', '/x', () => 1)`);
  assert.equal((await call(as('beta', 'eve'))).status, 404);
});

test('undeclared capability is denied, disables the extension and alerts', async () => {
  const { as, call, alerts, runtime } = setup(`openpearl.route('GET', '/x', () => openpearl.data.find('customers'))`);
  const res = await call(as('acme', 'alice'));
  assert.equal(res.status, 500);
  assert.equal(res.audit.denied.length, 1);
  assert.equal(alerts.length, 1);
  assert.match(runtime.status('acme', 'probe').disabled, /capability denied/);
  assert.equal((await call(as('acme', 'alice'))).status, 503);
});

test('undeclared route registration is denied', async () => {
  const { as, call } = setup(`openpearl.route('GET', '/x', () => 1); openpearl.route('GET', '/admin', () => 2)`);
  assert.equal((await call(as('acme', 'alice'))).audit.denied.length, 1);
});

for (const [name, src] of Object.entries({
  'constructor chain': `this.constructor.constructor('return process')()`,
  'function constructor': `(() => {}).constructor('return process')()`,
  'openpearl function constructor': `openpearl.data.find.constructor('return process')()`,
  'error constructor': `(() => { try { openpearl.data.find(1) } catch (e) { return e.constructor.constructor('return process')() } })()`,
  eval: `eval('process')`,
})) {
  test(`sandbox escape is blocked: ${name}`, async () => {
    const { as, call } = setup(`openpearl.route('GET', '/x', () => typeof (${src}))`);
    const res = await call(as('acme', 'alice'));
    assert.notEqual(res.body, 'object', JSON.stringify(res));
    assert.equal(res.status, 500);
  });
}

test('dynamic import is refused at install and at invoke', async () => {
  const { runtime } = setup(`openpearl.route('GET', '/x', () => 1)`);
  const bundle = signBundle(createBundle({ tenant: 'acme', slug: 'probe', manifest: manifest([]), source: `openpearl.route('GET', '/x', () => import('node:fs'))`, commit: 'c2' }), privateKey);
  assert.throws(() => runtime.install(bundle), /may not use import/);
  const res = invoke({ source: bundle.source, hostCall: () => '{}', method: 'GET', path: '/x' });
  assert.match(res.body.error, /may not use import/);
});

test('host globals are absent', async () => {
  const { as, call } = setup(`openpearl.route('GET', '/x', () => [typeof process, typeof require, typeof fetch, typeof setTimeout, typeof globalThis.Buffer])`);
  assert.deepEqual((await call(as('acme', 'alice'))).body, ['undefined', 'undefined', 'undefined', 'undefined', 'undefined']);
});

test('infinite loops time out and hostile throws are contained', async () => {
  const loop = setup(`openpearl.route('GET', '/x', () => { while (true) {} })`);
  assert.match((await loop.call(loop.as('acme', 'alice'))).body.error, /timed out/);
  const getter = setup(`throw { get message() { while (true) {} } }`);
  assert.equal((await getter.call(getter.as('acme', 'alice'))).body.error, 'extension failed');
  const promise = setup(`openpearl.route('GET', '/x', () => Promise.resolve(1))`);
  assert.match((await promise.call(promise.as('acme', 'alice'))).body.error, /not a promise/);
});

test('an unhandled rejection inside an extension does not crash a guarded host', async () => {
  // The test runner traps unhandled rejections itself, so run the host in a child process
  const host = `
    import { invoke, installRejectionGuard } from ${JSON.stringify(new URL('../runtime/sandbox.js', import.meta.url).href)};
    installRejectionGuard();
    invoke({ source: "Promise.reject(new Error('x')); openpearl.route('GET', '/x', () => 1)", hostCall: () => '{"value":null}', method: 'GET', path: '/x' });
    setTimeout(() => console.log('alive'), 20);`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', host], { encoding: 'utf8' });
  assert.equal(out.trim(), 'alive');
});

test('module state does not survive between requests', async () => {
  const { as, call } = setup(`var seen = (typeof seen === 'number' ? seen : 0) + 1; openpearl.route('GET', '/x', () => seen)`);
  assert.equal((await call(as('acme', 'alice'))).body, 1);
  assert.equal((await call(as('acme', 'bob'))).body, 1);
});

test('kv is scoped per user', async () => {
  const { as, call } = setup(
    `openpearl.route('POST', '/x', (req) => openpearl.kv.set('k', req.user.id)); openpearl.route('GET', '/x', () => openpearl.kv.get('k'))`,
    ['kv:read', 'kv:write'],
    [{ method: 'GET', path: '/x' }, { method: 'POST', path: '/x' }],
  );
  await call(as('acme', 'alice'), '/x', 'POST');
  assert.equal((await call(as('acme', 'alice'))).body, 'alice');
  assert.equal((await call(as('acme', 'bob'))).body, null);
});

test('runtime rejects tampered, unsigned and over-entitled bundles', async () => {
  const { runtime } = setup(`openpearl.route('GET', '/x', () => 1)`);
  const good = signBundle(createBundle({ tenant: 'acme', slug: 'probe', manifest: manifest(['data:read:orders']), source: `openpearl.route('GET', '/x', () => 1)`, commit: 'c2' }), privateKey);
  assert.throws(() => runtime.install({ ...good, source: `openpearl.route('GET', '/x', () => 2)` }), /signature/);
  assert.throws(() => runtime.install({ ...good, signature: undefined }), /signature/);
  const greedy = signBundle(createBundle({ tenant: 'beta', slug: 'probe', manifest: manifest(['data:read:customers']), source: 'x', commit: 'c3' }), privateKey);
  assert.throws(() => runtime.install(greedy), /not in the tenant's plan/);
});

test('rollback restores the previous version', async () => {
  const { runtime, as, call } = setup(`openpearl.route('GET', '/x', () => 'v1')`);
  runtime.install(signBundle(createBundle({ tenant: 'acme', slug: 'probe', manifest: manifest([]), source: `openpearl.route('GET', '/x', () => 'v2')`, commit: 'c2' }), privateKey));
  assert.equal((await call(as('acme', 'alice'))).body, 'v2');
  assert.equal(runtime.rollback('acme', 'probe'), 'c1');
  assert.equal((await call(as('acme', 'alice'))).body, 'v1');
});

test('the isolation harness fails fast on a handler that hangs', async () => {
  const { runIsolation } = await import('../../isolation/harness.js');
  const report = await runIsolation({
    tenant: 'acme',
    extension: { slug: 'probe', manifest: manifest([]), source: `openpearl.route('GET', '/x', () => { while (true) {} })` },
    policies,
    entitlements,
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.timeouts, 3);
});

test('sensitive fields need their own capability and an allowed role, and never reach logs', async () => {
  const { store, runtime, as } = setup(
    `openpearl.route('GET', '/x', () => { const c = openpearl.data.find('customers'); openpearl.log('saw', c.map((r) => r.email).join(' ')); return c; })`,
    ['data:read:customers', 'data:read:customers.email', 'data:read:customers.phone', 'log'],
  );
  await store.seed('acme', 'customers', 'alice', { title: 'Ada', email: 'ada@example.com', phone: '555-0100' });
  const member = await runtime.handle({ session: as('acme', 'alice'), slug: 'probe', method: 'GET', path: '/x' });
  assert.equal(member.body[0].email, 'ada@example.com');
  assert.equal(member.body[0].phone, undefined, 'phone is admin-only');
  assert.doesNotMatch(member.audit.logs.join(), /ada@example\.com/);
  assert.equal(member.audit.redactions, 1);
  const admin = await runtime.handle({ session: as('acme', 'root', ['admin']), slug: 'probe', method: 'GET', path: '/x' });
  assert.equal(admin.body[0].phone, '555-0100');
});

test('without the field capability a sensitive field is masked', async () => {
  const { store, runtime, as } = setup(`openpearl.route('GET', '/x', () => openpearl.data.find('customers'))`, ['data:read:customers']);
  await store.seed('acme', 'customers', 'alice', { title: 'Ada', email: 'ada@example.com' });
  const res = await runtime.handle({ session: as('acme', 'root', ['admin']), slug: 'probe', method: 'GET', path: '/x' });
  assert.deepEqual(Object.keys(res.body[0]).sort(), ['id', 'owner', 'title']);
});
