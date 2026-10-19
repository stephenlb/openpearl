// Behavioural acceptance specs for an extension, written by an agent that sees
// the request, manifest and README but never the code. Each case seeds data,
// calls one route as one persona and checks the response.
//
// { "version": 1, "cases": [{
//     "name": "totals two orders",
//     "as": "member",                                    // member | peer | admin
//     "seed": [{ "ref": "o1", "collection": "orders", "owner": "member", "doc": { "amount": 5 } }],
//     "request": { "method": "GET", "path": "/summary", "query": { "id": "{{o1}}" }, "body": null },
//     "expect": { "status": 200, "body": { "total": 5 }, "match": "subset", "includes": ["..."], "excludes": ["..."] }
// }] }
//
// "{{ref}}" anywhere in the request or expectation is replaced with the seeded row's id.
import { createStore } from '../framework/core/store.js';
import { createRuntime } from '../framework/runtime/runtime.js';
import { createExecutor } from '../framework/runtime/executor.js';
import { createBundle } from '../framework/core/bundle.js';

export const MAX_CASES = 50;
const PERSONAS = { member: [], peer: [], admin: ['admin'] };
const CASE_KEYS = new Set(['name', 'as', 'seed', 'request', 'expect']);
const EXPECT_KEYS = new Set(['status', 'body', 'match', 'includes', 'excludes']);
const REF = /^[a-z][a-z0-9_]{0,31}$/;

export function validateSpec(spec, manifest, policies) {
  const errors = [];
  if (spec === null || typeof spec !== 'object' || spec.version !== 1 || !Array.isArray(spec.cases)) return ['spec must be { "version": 1, "cases": [...] }'];
  if (spec.cases.length < 1 || spec.cases.length > MAX_CASES) errors.push(`spec must have 1-${MAX_CASES} cases`);
  const routes = new Set(manifest.routes.map((r) => `${r.method} ${r.path}`));
  const names = new Set();
  spec.cases.forEach((c, i) => {
    const at = `case ${i + 1}`;
    if (c === null || typeof c !== 'object') return errors.push(`${at}: must be an object`);
    for (const k of Object.keys(c)) if (!CASE_KEYS.has(k)) errors.push(`${at}: unknown field ${k}`);
    if (typeof c.name !== 'string' || !c.name || c.name.length > 120) errors.push(`${at}: name must be 1-120 characters`);
    else if (names.has(c.name)) errors.push(`${at}: duplicate name`);
    else names.add(c.name);
    if (!Object.hasOwn(PERSONAS, c.as)) errors.push(`${at}: "as" must be member, peer or admin`);
    if (c.seed !== undefined && (!Array.isArray(c.seed) || c.seed.length > 50)) errors.push(`${at}: seed must be a list of at most 50 rows`);
    for (const row of c.seed ?? []) {
      if (!row || !Object.hasOwn(policies, row.collection)) errors.push(`${at}: seed row has an unknown collection`);
      if (!row || !Object.hasOwn(PERSONAS, row.owner)) errors.push(`${at}: seed row owner must be member, peer or admin`);
      if (!row || row.doc === null || typeof row.doc !== 'object' || Array.isArray(row.doc)) errors.push(`${at}: seed row doc must be an object`);
      if (row?.ref !== undefined && !REF.test(String(row.ref))) errors.push(`${at}: invalid seed ref`);
    }
    if (!c.request || !routes.has(`${c.request.method} ${c.request.path}`)) errors.push(`${at}: request must call a route in the manifest`);
    if (!c.expect || typeof c.expect !== 'object') errors.push(`${at}: expect is required`);
    else {
      for (const k of Object.keys(c.expect)) if (!EXPECT_KEYS.has(k)) errors.push(`${at}: unknown expect field ${k}`);
      if (c.expect.match !== undefined && c.expect.match !== 'exact' && c.expect.match !== 'subset') errors.push(`${at}: match must be exact or subset`);
      for (const k of ['includes', 'excludes']) {
        if (c.expect[k] !== undefined && (!Array.isArray(c.expect[k]) || c.expect[k].some((x) => typeof x !== 'string'))) errors.push(`${at}: ${k} must be a list of strings`);
      }
    }
  });
  return errors;
}

const fill = (value, refs) => JSON.parse(JSON.stringify(value ?? null).replace(/\{\{([a-z][a-z0-9_]{0,31})\}\}/g, (m, r) => refs[r] ?? m));

// Subset: every expected key/element appears in actual (arrays: order-insensitive, extra elements allowed)
export function matches(actual, expected, exact) {
  if (exact) return JSON.stringify(actual) === JSON.stringify(expected);
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    const used = new Set();
    return expected.every((e) => {
      const i = actual.findIndex((a, j) => !used.has(j) && matches(a, e, false));
      if (i < 0) return false;
      used.add(i);
      return true;
    });
  }
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;
  return Object.entries(expected).every(([k, v]) => Object.hasOwn(actual, k) && matches(actual[k], v, false));
}

// specs: list of spec objects (e.g. the committed regression spec plus a new one)
export async function runSpecs({ tenant, extension, specs, policies, entitlements }) {
  const report = { status: 'fail', tenant, slug: extension.slug, cases: [], errors: [] };
  for (const spec of specs) report.errors.push(...validateSpec(spec, extension.manifest, policies));
  if (report.errors.length) return report;
  const executor = createExecutor({ size: 1 });
  try {
    await runCases({ tenant, extension, specs, policies, entitlements, executor, report });
  } finally {
    await executor.close();
  }
  if (report.cases.every((c) => c.status === 'pass')) report.status = 'pass';
  return report;
}

async function runCases({ tenant, extension, specs, policies, entitlements, executor, report }) {
  for (const c of specs.flatMap((s) => s.cases)) {
    // A fresh store and runtime per case: cases can't depend on each other
    const store = createStore(policies);
    const runtime = createRuntime({ store, policies, entitlements, requireSignature: false, executor });
    try {
      runtime.install(createBundle({ tenant, slug: extension.slug, manifest: extension.manifest, source: extension.source, commit: 'candidate' }));
      const refs = {};
      for (const row of c.seed ?? []) {
        const seeded = await store.seed(tenant, row.collection, row.owner, row.doc);
        if (row.ref) refs[row.ref] = seeded.id;
      }
      const session = store.session({ tenant, user: c.as, roles: PERSONAS[c.as] });
      const request = fill(c.request, refs);
      const expect = fill(c.expect, refs);
      const res = await runtime.handle({ session, slug: extension.slug, method: request.method, path: request.path, query: request.query ?? {}, body: request.body ?? null });
      const text = JSON.stringify(res.body) ?? '';
      const problems = [];
      if (res.audit.denied.length) problems.push(`capability denied: ${res.audit.denied[0].reason}`);
      if ((expect.status ?? 200) !== res.status) problems.push(`status ${res.status}, expected ${expect.status ?? 200}`);
      if (expect.body !== undefined && !matches(res.body, expect.body, expect.match === 'exact')) problems.push(`body ${text.slice(0, 300)} does not match ${JSON.stringify(expect.body).slice(0, 300)}`);
      for (const s of expect.includes ?? []) if (!text.includes(s)) problems.push(`body does not include ${JSON.stringify(s)}`);
      for (const s of expect.excludes ?? []) if (text.includes(s)) problems.push(`body includes ${JSON.stringify(s)}`);
      report.cases.push({ name: c.name, status: problems.length ? 'fail' : 'pass', problems });
    } catch (e) {
      report.cases.push({ name: c.name, status: 'fail', problems: [e.message] });
    }
  }
}
