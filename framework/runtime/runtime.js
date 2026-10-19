// Extension host: installs signed bundles per tenant and routes requests to them.
// The tenant comes from the authenticated session, never from the request.
import { validateManifest, unentitled, TENANT, SLUG } from '../core/manifest.js';
import { verifyBundle } from '../core/bundle.js';
import { createHostCall } from '../sdk/host.js';
import { checkSource } from './sandbox.js';
import { createExecutor } from './executor.js';

export function createRuntime({ store, policies, entitlements, publicKey, requireSignature = true, onAlert = () => {}, executor = createExecutor() }) {
  const installed = new Map(); // `${tenant}/${slug}` -> bundle[] (newest last)
  const disabled = new Map(); // `${tenant}/${slug}` -> reason

  const check = (bundle) => {
    if (requireSignature && !verifyBundle(bundle, publicKey)) return 'bundle signature is invalid';
    const { tenant, slug, manifest, source } = bundle;
    if (!TENANT.test(String(tenant)) || !SLUG.test(String(slug))) return 'invalid tenant or slug';
    const errors = validateManifest(manifest, { slug, policies });
    if (errors.length) return `invalid manifest: ${errors.join('; ')}`;
    const extra = unentitled(manifest.capabilities, tenant, entitlements);
    if (extra.length) return `capabilities not in the tenant's plan: ${extra.join(', ')}`;
    return checkSource(source);
  };

  return {
    install(bundle) {
      const bad = check(bundle);
      if (bad) throw new Error(bad);
      const key = `${bundle.tenant}/${bundle.slug}`;
      installed.set(key, [...(installed.get(key) ?? []), bundle]);
      disabled.delete(key);
    },
    rollback(tenant, slug) {
      const key = `${tenant}/${slug}`;
      const versions = installed.get(key) ?? [];
      versions.pop();
      if (versions.length) installed.set(key, versions);
      else installed.delete(key);
      return versions.at(-1)?.commit ?? null;
    },
    disable(tenant, slug, reason) {
      disabled.set(`${tenant}/${slug}`, reason);
    },
    enable(tenant, slug) {
      disabled.delete(`${tenant}/${slug}`);
    },
    status(tenant, slug) {
      const key = `${tenant}/${slug}`;
      const current = installed.get(key)?.at(-1);
      return { installed: Boolean(current), commit: current?.commit ?? null, disabled: disabled.get(key) ?? null };
    },
    close() {
      return executor.close();
    },
    async handle({ session, slug, method, path, query = {}, body = null }) {
      const tenant = store.tenantOf(session);
      const key = `${tenant}/${slug}`;
      const bundle = installed.get(key)?.at(-1);
      const audit = { events: [], logs: [], denied: [], rejected: [] };
      if (!bundle) return { status: 404, body: { error: 'no such extension' }, audit };
      if (disabled.has(key)) return { status: 503, body: { error: 'extension disabled' }, audit };
      const hostCall = createHostCall({ store, session, manifest: bundle.manifest, audit, policies });
      const req = { method, path, query, body, user: store.whoami(session) };
      const res = await executor.run({ source: bundle.source, ops: hostCall, method, path, req });
      // Reaching past the manifest is never legitimate: take the extension offline and alert
      if (audit.denied.length) {
        disabled.set(key, `capability denied: ${audit.denied[0].reason}`);
        onAlert({ tenant, slug, commit: bundle.commit, denied: audit.denied });
      }
      return { ...res, audit };
    },
  };
}
