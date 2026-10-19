// Tenant-isolation harness: seeds canary data for several tenants and users,
// drives a candidate extension with hostile inputs as every persona of the
// requesting tenant, then checks that no persona ever observed a canary it is
// not entitled to see, whether in responses, logs or data it can read afterwards.
import { randomBytes } from 'node:crypto';
import { createStore } from '../framework/core/store.js';
import { createRuntime } from '../framework/runtime/runtime.js';
import { createBundle } from '../framework/core/bundle.js';
import { sensitiveFields } from '../framework/core/manifest.js';

const OTHER = 'zz-other';

// Personas of the requesting tenant; `member` and `peer` are ordinary users.
const personas = (tenant) => [
  { tenant, user: 'member', roles: [] },
  { tenant, user: 'peer', roles: [] },
  { tenant, user: 'admin', roles: ['admin'] },
];

async function seed(store, policies, tenant) {
  const canaries = []; // { value, tenant, owner, collection, field? }
  const ids = [];
  const owners = [...personas(tenant).map((p) => [tenant, p.user]), [OTHER, 'outsider']];
  const canary = () => `CANARY-${randomBytes(6).toString('hex')}`;
  for (const collection of Object.keys(policies)) {
    for (const [t, owner] of owners) {
      const doc = { title: `${collection} of ${owner}`, secret: canary(), amount: 42 };
      // Every sensitive field gets its own canary, so leaks of one field are told apart
      for (const field of Object.keys(sensitiveFields(policies, collection))) doc[field] = canary();
      const row = await store.seed(t, collection, owner, doc);
      canaries.push({ value: doc.secret, tenant: t, owner, collection });
      for (const field of Object.keys(sensitiveFields(policies, collection))) canaries.push({ value: doc[field], tenant: t, owner, collection, field });
      ids.push(row.id);
    }
  }
  return { canaries, ids };
}

// where: 'response' | 'logs' | 'stored'. Sensitive values may only reach a response,
// and only with the field capability and an allowed role. Seen in logs or copied into
// stored data, they are a leak for everyone.
const entitled = (persona, canary, policies, capabilities, where) => {
  const row =
    canary.tenant === persona.tenant &&
    (policies[canary.collection].visibility === 'tenant' || canary.owner === persona.user || persona.roles.includes('admin'));
  if (!row || !canary.field) return row;
  if (where !== 'response') return false;
  const rule = sensitiveFields(policies, canary.collection)[canary.field];
  return capabilities.includes(`data:read:${canary.collection}.${canary.field}`) && (!rule.roles || rule.roles.some((r) => persona.roles.includes(r)));
};

// Hostile and ordinary inputs; ids include rows of other users and tenants.
function inputs(ids, tenant) {
  const out = [{}, { id: ids[0] }, { tenant: OTHER }, { owner: 'outsider' }, { user: 'admin' }, { tenant: OTHER, id: ids.at(-1) }];
  for (const id of ids) out.push({ id }, { id, owner: 'member' });
  out.push({ id: '../../zz-other' }, { id: '*' }, { id: { $ne: null } }, { q: "' OR 1=1 --" }, { q: 'x'.repeat(10_000) });
  out.push(JSON.parse('{"__proto__": {"admin": true}, "roles": ["admin"]}'), { filter: { tenant: OTHER } }, { tenant });
  return out;
}

// extension: { slug, manifest, source }. store: optional fresh store (e.g. Postgres); defaults to in-memory.
export async function runIsolation({ tenant, extension, policies, entitlements, store = createStore(policies) }) {
  const { canaries, ids } = await seed(store, policies, tenant);
  const alerts = [];
  const runtime = createRuntime({ store, policies, entitlements, requireSignature: false, onAlert: (a) => alerts.push(a) });
  const violations = [];
  const report = { status: 'fail', tenant, slug: extension.slug, invocations: 0, errors: 0, timeouts: 0, rejected: 0, redactions: 0, denied: [], violations };
  try {
    runtime.install(createBundle({ tenant, slug: extension.slug, manifest: extension.manifest, source: extension.source, commit: 'candidate' }));
  } catch (e) {
    report.installError = e.message;
    await runtime.close();
    return report;
  }
  try {
    return await drive({ runtime, store, tenant, extension, policies, canaries, ids, report, alerts });
  } finally {
    await runtime.close();
  }
}

async function drive({ runtime, store, tenant, extension, policies, canaries, ids, report, alerts }) {
  const violations = report.violations;
  const people = personas(tenant).map((p) => ({ ...p, session: store.session(p) }));
  const caps = extension.manifest.capabilities ?? [];
  const check = (persona, where, kind, text) => {
    for (const c of canaries) {
      if (text.includes(c.value) && !entitled(persona, c, policies, caps, kind)) {
        violations.push({ persona: persona.user, where, canary: `${c.collection}${c.field ? `.${c.field}` : ''} of ${c.tenant}/${c.owner}` });
      }
    }
  };
  // Writers go first so laundering (one user's data written where another can read it) is caught afterwards
  for (const persona of [people[2], people[1], people[0]]) {
    for (const route of extension.manifest.routes) {
      for (const input of inputs(ids, tenant)) {
        // The runtime disables an extension on its first denial; keep driving it to collect evidence
        runtime.enable(tenant, extension.slug);
        const res = await runtime.handle({ session: persona.session, slug: extension.slug, method: route.method, path: route.path, query: input, body: input });
        report.invocations++;
        if (res.status >= 500) report.errors++;
        // Each timeout costs a full second; a handler that hangs on hostile input fails fast
        if (res.status === 500 && /timed out/.test(res.body?.error ?? '') && ++report.timeouts >= 3) {
          report.reason = 'handler timed out on 3 inputs';
          return report;
        }
        report.rejected += res.audit.rejected.length;
        report.redactions += res.audit.redactions ?? 0;
        for (const d of res.audit.denied) if (report.denied.length < 20) report.denied.push(`${persona.user}: ${d.reason}`);
        check(persona, `${route.method} ${route.path} response`, 'response', JSON.stringify(res.body) ?? '');
        check(persona, `${route.method} ${route.path} logs`, 'logs', res.audit.logs.join('\n'));
      }
    }
  }
  // Afterwards, everything each persona can read must still be theirs to read
  for (const persona of people) {
    for (const collection of Object.keys(policies)) {
      // Drop the original sensitive fields: any sensitive value still visible was copied somewhere
      const rows = (await store.find(persona.session, collection)).map((row) => {
        for (const field of Object.keys(sensitiveFields(policies, collection))) delete row[field];
        return row;
      });
      check(persona, `${collection} collection`, 'stored', JSON.stringify(rows));
    }
  }
  // Writing sensitive values to logs is a violation even though the platform redacts them
  if (!report.denied.length && !violations.length && !report.redactions) report.status = 'pass';
  report.alerts = alerts.length;
  return report;
}
