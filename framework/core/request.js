// Signed feature requests: the intake service authenticates the customer and
// signs { tenant, user, slug, text }. The pipeline trusts only these signed
// fields, never the issue title, body or author association.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { TENANT, SLUG } from './manifest.js';

const MARK = /<!-- openpearl-request v1 ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+) -->/;
export const MAX_TEXT = 4000;
export const MAX_AGE_MS = 60 * 60 * 1000;

const mac = (payload, key) => createHmac('sha256', key).update(payload).digest('base64url');

export function slugFor(id) {
  return `req-${id.replace(/-/g, '').slice(0, 10)}`;
}

export function createRequest({ tenant, user, text, slug, now = Date.now() }) {
  if (!TENANT.test(String(tenant))) throw new Error('invalid tenant');
  if (typeof user !== 'string' || !/^[A-Za-z0-9._@-]{1,128}$/.test(user)) throw new Error('invalid user');
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new Error(`request text must be 1-${MAX_TEXT} characters`);
  if (slug !== undefined && !SLUG.test(String(slug))) throw new Error('invalid extension slug');
  const id = randomUUID();
  return { v: 1, id, tenant, user, slug: slug ?? slugFor(id), text, ts: now };
}

// Issue body: a human-readable quote of the request plus the signed marker.
export function encodeRequest(request, key) {
  const payload = Buffer.from(JSON.stringify(request)).toString('base64url');
  const quoted = request.text.replace(/<!--|-->/g, '').split('\n').map((l) => `> ${l}`).join('\n');
  return `Feature request from tenant \`${request.tenant}\` for extension \`${request.slug}\`:\n\n${quoted}\n\n<!-- openpearl-request v1 ${payload}.${mac(payload, key)} -->\n`;
}

// Returns the verified request, or throws. Fails closed on any irregularity.
export function verifyRequest(body, key, { now = Date.now() } = {}) {
  if (!key) throw new Error('no intake key configured');
  const matches = [...String(body).matchAll(new RegExp(MARK, 'g'))];
  if (matches.length !== 1) throw new Error('expected exactly one signed request marker');
  const [, payload, sig] = matches[0];
  const want = Buffer.from(mac(payload, key));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw new Error('request signature is invalid');
  const req = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (req.v !== 1 || !TENANT.test(String(req.tenant)) || !SLUG.test(String(req.slug))) throw new Error('request fields are invalid');
  if (typeof req.text !== 'string' || req.text.length > MAX_TEXT) throw new Error('request text is invalid');
  if (typeof req.ts !== 'number' || now - req.ts > MAX_AGE_MS || req.ts - now > 60_000) throw new Error('request is expired');
  return req;
}

// Signed approvals: a tenant admin approved the preview of a request's extension.
// Passed to the promote workflow as a single token "<payload>.<mac>".
export function signApproval({ id, tenant, slug, user, issue, now = Date.now() }, key) {
  const payload = Buffer.from(JSON.stringify({ v: 1, kind: 'approve', id, tenant, slug, user, issue, ts: now })).toString('base64url');
  return `${payload}.${mac(payload, key)}`;
}

export function verifyApproval(token, key, { now = Date.now() } = {}) {
  if (!key) throw new Error('no intake key configured');
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(token));
  if (!m) throw new Error('malformed approval');
  const want = Buffer.from(mac(m[1], key));
  const got = Buffer.from(m[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw new Error('approval signature is invalid');
  const a = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
  if (a.v !== 1 || a.kind !== 'approve' || !TENANT.test(String(a.tenant)) || !SLUG.test(String(a.slug)) || !Number.isInteger(a.issue)) throw new Error('approval fields are invalid');
  if (typeof a.ts !== 'number' || now - a.ts > MAX_AGE_MS || a.ts - now > 60_000) throw new Error('approval is expired');
  return a;
}
