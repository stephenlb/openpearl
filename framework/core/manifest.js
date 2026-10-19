// Extension manifest validation and capability entitlement checks.
// Shared by the merge gates, the runtime and the deploy step so all three agree.

export const TENANT = /^[a-z0-9][a-z0-9-]{1,38}$/;
export const SLUG = /^[a-z][a-z0-9-]{1,38}$/;
const PATH = /^\/[a-z0-9][a-z0-9/_-]{0,99}$/;
const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);
const CAPABILITY = /^(data:(read|write):[a-z][a-z0-9_]{0,63}(\.[a-z][a-zA-Z0-9_]{0,63})?|kv:(read|write)|log)$/;
const KEYS = new Set(['version', 'name', 'description', 'routes', 'capabilities']);

// Returns a list of errors; an empty list means the manifest is valid.
export function validateManifest(manifest, { slug, policies } = {}) {
  const errors = [];
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return ['manifest must be a JSON object'];
  for (const k of Object.keys(manifest)) if (!KEYS.has(k)) errors.push(`unknown manifest field: ${k}`);
  if (manifest.version !== 1) errors.push('version must be 1');
  if (typeof manifest.name !== 'string' || !SLUG.test(manifest.name)) errors.push('name must be a lowercase slug');
  else if (slug !== undefined && manifest.name !== slug) errors.push(`name "${manifest.name}" must match the directory "${slug}"`);
  if (typeof manifest.description !== 'string' || manifest.description.length < 1 || manifest.description.length > 500) {
    errors.push('description must be 1-500 characters');
  }
  if (!Array.isArray(manifest.routes) || manifest.routes.length < 1 || manifest.routes.length > 20) {
    errors.push('routes must list 1-20 routes');
  } else {
    const seen = new Set();
    for (const r of manifest.routes) {
      if (r === null || typeof r !== 'object' || Object.keys(r).some((k) => k !== 'method' && k !== 'path')) {
        errors.push('each route must be { method, path }');
        continue;
      }
      if (!METHODS.has(r.method)) errors.push(`route method must be one of ${[...METHODS].join(', ')}`);
      if (typeof r.path !== 'string' || !PATH.test(r.path) || r.path.includes('//')) errors.push(`invalid route path: ${String(r.path)}`);
      const key = `${r.method} ${r.path}`;
      if (seen.has(key)) errors.push(`duplicate route: ${key}`);
      seen.add(key);
    }
  }
  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length > 20) {
    errors.push('capabilities must be a list of at most 20 entries');
  } else {
    for (const c of manifest.capabilities) {
      if (typeof c !== 'string' || !CAPABILITY.test(c)) {
        errors.push(`invalid capability: ${String(c)}`);
      } else if (policies && c.startsWith('data:')) {
        const [collection, field] = c.split(':')[2].split('.');
        if (!Object.hasOwn(policies, collection)) errors.push(`capability names an unknown collection: ${c}`);
        else if (field !== undefined && !Object.hasOwn(policies[collection].sensitive ?? {}, field)) {
          errors.push(`field capabilities are only for sensitive fields: ${c}`);
        }
      }
    }
    if (new Set(manifest.capabilities).size !== manifest.capabilities.length) errors.push('capabilities must not repeat');
  }
  return errors;
}

// A plan grant may end in `*` (e.g. data:read:*), matching any collection.
// Wildcards never cover sensitive fields (data:read:customers.email): those are granted one by one.
export function granted(capability, grants) {
  return grants.some((g) => g === capability || (g.endsWith(':*') && !capability.includes('.') && capability.startsWith(g.slice(0, -1))));
}

// Sensitive fields of a collection: { field: { class, roles? } }
export function sensitiveFields(policies, collection) {
  return policies[collection]?.sensitive ?? {};
}

// Capabilities the tenant's plan does not allow; unknown tenants are allowed nothing.
export function unentitled(capabilities, tenant, entitlements) {
  const plan = Object.hasOwn(entitlements.tenants, tenant) && entitlements.plans[entitlements.tenants[tenant].plan];
  if (!plan) return [...capabilities];
  return capabilities.filter((c) => !granted(c, plan.capabilities));
}

export function planFor(tenant, entitlements) {
  if (!Object.hasOwn(entitlements.tenants, tenant)) return null;
  return entitlements.plans[entitlements.tenants[tenant].plan] ?? null;
}
