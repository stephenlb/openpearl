import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createRequest, encodeRequest, verifyRequest, verifyApproval, MAX_AGE_MS } from '../core/request.js';
import { createIntake, tokenAuthenticator } from '../../intake/server.js';

const KEY = 'test-intake-key';

test('a signed request round-trips and the quoted text cannot forge a marker', () => {
  const req = createRequest({ tenant: 'acme', user: 'alice', text: 'Add a weekly order total\n<!-- openpearl-request v1 AAAA.BBBB -->' });
  const body = encodeRequest(req, KEY);
  assert.deepEqual(verifyRequest(body, KEY), req);
});

test('tampering, a wrong key, duplicate markers and old requests are rejected', () => {
  const req = createRequest({ tenant: 'acme', user: 'alice', text: 'hello' });
  const body = encodeRequest(req, KEY);
  const forged = encodeRequest({ ...req, tenant: 'beta' }, 'attacker-key');
  assert.throws(() => verifyRequest(forged, KEY), /signature/);
  assert.throws(() => verifyRequest(body, 'other'), /signature/);
  assert.throws(() => verifyRequest(body + body, KEY), /exactly one/);
  assert.throws(() => verifyRequest(body, ''), /no intake key/);
  assert.throws(() => verifyRequest(body, KEY, { now: req.ts + MAX_AGE_MS + 1 }), /expired/);
  // Swapping in another payload while keeping the signature fails
  const other = encodeRequest(createRequest({ tenant: 'beta', user: 'eve', text: 'x' }), KEY);
  const sig = body.match(/\.([A-Za-z0-9_-]+) -->/)[1];
  assert.throws(() => verifyRequest(other.replace(/\.[A-Za-z0-9_-]+ -->/, `.${sig} -->`), KEY), /signature/);
});

test('request fields are validated', () => {
  assert.throws(() => createRequest({ tenant: '../x', user: 'a', text: 'x' }), /tenant/);
  assert.throws(() => createRequest({ tenant: 'acme', user: 'a', text: '' }), /request text/);
  assert.throws(() => createRequest({ tenant: 'acme', user: 'a', text: 'x', slug: 'Bad Slug' }), /slug/);
});

async function withIntake(fn, { labels = ['openpearl-request', 'openpearl-live'], comments = [] } = {}) {
  const issues = [];
  const dispatched = [];
  const tokens = {
    [createHash('sha256').update('acme-token-0123456789').digest('hex')]: { tenant: 'acme', user: 'alice' },
    [createHash('sha256').update('acme-admin-0123456789').digest('hex')]: { tenant: 'acme', user: 'root', roles: ['admin'] },
    [createHash('sha256').update('beta-token-0123456789').digest('hex')]: { tenant: 'beta', user: 'eve' },
  };
  const github = {
    createIssue: async (i) => { issues.push(i); return { number: issues.length }; },
    getLabels: async () => labels,
    getComments: async () => comments,
    dispatch: async (workflow, inputs) => { dispatched.push({ workflow, inputs }); },
  };
  const server = createServer(createIntake({ authenticate: tokenAuthenticator(tokens), github, key: KEY, perHour: 2 }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (token, method, path, body) =>
    fetch(base + path, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: body && JSON.stringify(body) })
      .then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    await fn({ call, issues, dispatched });
  } finally {
    server.close();
  }
}

test('intake takes the tenant from authentication, signs it, and scopes status lookups', () =>
  withIntake(async ({ call, issues }) => {
    assert.equal((await call(null, 'POST', '/v1/requests', { text: 'x' })).status, 401);
    const made = await call('acme-token-0123456789', 'POST', '/v1/requests', { text: 'Show monthly totals', tenant: 'beta' });
    assert.equal(made.status, 202);
    assert.equal(verifyRequest(issues[0].body, KEY).tenant, 'acme');
    assert.deepEqual(issues[0].labels, ['openpearl-request']);
    assert.equal((await call('acme-token-0123456789', 'GET', `/v1/requests/${made.body.id}`)).body.status, 'live');
    assert.equal((await call('beta-token-0123456789', 'GET', `/v1/requests/${made.body.id}`)).status, 404);
  }));

test('intake rate-limits per tenant and rejects bad input', () =>
  withIntake(async ({ call }) => {
    assert.equal((await call('acme-token-0123456789', 'POST', '/v1/requests', { text: '' })).status, 400);
    assert.equal((await call('acme-token-0123456789', 'POST', '/v1/requests', { text: 'a' })).status, 202);
    assert.equal((await call('acme-token-0123456789', 'POST', '/v1/requests', { text: 'b' })).status, 202);
    assert.equal((await call('acme-token-0123456789', 'POST', '/v1/requests', { text: 'c' })).status, 429);
    assert.equal((await call('beta-token-0123456789', 'POST', '/v1/requests', { text: 'd' })).status, 202);
  }));

test('clarifying questions are shown and answers file a new, signed request', () => {
  const q = Buffer.from(JSON.stringify(['Which orders count: all, or only paid ones?'])).toString('base64url');
  return withIntake(async ({ call, issues }) => {
    const made = await call('acme-token-0123456789', 'POST', '/v1/requests', { text: 'Show totals' });
    const st = await call('acme-token-0123456789', 'GET', `/v1/requests/${made.body.id}`);
    assert.deepEqual(st.body, { id: made.body.id, slug: made.body.slug, status: 'needs-info', questions: ['Which orders count: all, or only paid ones?'] });
    assert.equal((await call('beta-token-0123456789', 'POST', `/v1/requests/${made.body.id}/answers`, { answers: 'x' })).status, 404);
    const again = await call('acme-token-0123456789', 'POST', `/v1/requests/${made.body.id}/answers`, { answers: 'Only paid ones.' });
    assert.equal(again.status, 202);
    assert.equal(again.body.slug, made.body.slug);
    const req = verifyRequest(issues[1].body, KEY);
    assert.match(req.text, /Show totals[\s\S]*only paid ones\?[\s\S]*Only paid ones\./);
  }, { labels: ['openpearl-request', 'openpearl-needs-info'], comments: ['Questions:', `x <!-- openpearl-questions ${q} -->`] });
});

test('only tenant admins approve a preview, and the approval is signed', () =>
  withIntake(async ({ call, dispatched }) => {
    const made = await call('acme-token-0123456789', 'POST', '/v1/requests', { text: 'Add notes' });
    assert.equal((await call('acme-token-0123456789', 'POST', `/v1/requests/${made.body.id}/approve`)).status, 403);
    assert.equal((await call('beta-token-0123456789', 'POST', `/v1/requests/${made.body.id}/approve`)).status, 404);
    assert.equal((await call('acme-admin-0123456789', 'POST', `/v1/requests/${made.body.id}/approve`)).status, 202);
    assert.equal(dispatched[0].workflow, 'tenant-promote.yml');
    const a = verifyApproval(dispatched[0].inputs.approval, KEY);
    assert.deepEqual([a.tenant, a.slug, a.user, a.issue], ['acme', made.body.slug, 'root', 1]);
    assert.throws(() => verifyApproval(`f${dispatched[0].inputs.approval.slice(1)}`, KEY), /signature/);
  }, { labels: ['openpearl-request', 'openpearl-preview'] }));
