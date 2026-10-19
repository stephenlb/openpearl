// Signed extension bundles: what the gates approved is exactly what the runtime runs.
import { createHash, sign, verify } from 'node:crypto';

// Canonical JSON (sorted keys) so the signature covers content, not formatting.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function createBundle({ tenant, slug, manifest, source, commit }) {
  const sha256 = createHash('sha256').update(source).digest('hex');
  return { version: 1, tenant, slug, commit, manifest, source, sha256 };
}

// Ed25519 keys in PEM form
export function signBundle(bundle, privateKeyPem) {
  const { signature, ...body } = bundle;
  return { ...body, signature: sign(null, Buffer.from(canonical(body)), privateKeyPem).toString('base64') };
}

export function verifyBundle(bundle, publicKeyPem) {
  if (bundle === null || typeof bundle !== 'object' || typeof bundle.signature !== 'string') return false;
  const { signature, ...body } = bundle;
  if (typeof body.source !== 'string' || createHash('sha256').update(body.source).digest('hex') !== body.sha256) return false;
  try {
    return verify(null, Buffer.from(canonical(body)), publicKeyPem, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}
