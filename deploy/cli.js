#!/usr/bin/env node
// Usage: OPENPEARL_SIGNING_KEY=<ed25519 PEM> (or OPENPEARL_SIGNING_KEY_FILE=<path>) node deploy/cli.js --tenant <id> --slug <slug> --commit <sha>
//          [--repo .] [--adapter local|command] [--channel auto|live|preview]
//        node deploy/cli.js --promote --tenant <id> --slug <slug> [--adapter ...]    (a tenant admin approved the preview)
//        node deploy/cli.js --rollback --tenant <id> --slug <slug> [--adapter ...]
// Builds and signs the bundle, stages it, smoke-tests the signed artifact in a
// fresh runtime, then enables it for the requesting tenant only. With --channel auto
// (the default), extensions that write data, or tenants whose plan says previewRequired,
// go to the preview channel first and only go live once a tenant admin approves.
// Exit codes: 0 = live or in preview, 1 = deploy failed (the previous version stays live), 2 = usage error.
import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createBundle, signBundle } from '../framework/core/bundle.js';
import { loadExtension, loadJson } from '../framework/core/extension.js';
import { createStore } from '../framework/core/store.js';
import { createRuntime } from '../framework/runtime/runtime.js';
import { installRejectionGuard } from '../framework/runtime/sandbox.js';
import { localAdapter } from './adapters/local.js';
import { commandAdapter } from './adapters/command.js';

const { values } = parseArgs({
  options: {
    tenant: { type: 'string' }, slug: { type: 'string' }, commit: { type: 'string' },
    repo: { type: 'string', default: '.' }, adapter: { type: 'string', default: 'local' }, rollback: { type: 'boolean' },
    promote: { type: 'boolean' }, channel: { type: 'string', default: 'auto' },
  },
});
const usage = () => {
  console.error('Usage: node deploy/cli.js --tenant <id> --slug <slug> --commit <sha> [--repo .] [--adapter local|command] [--channel auto|live|preview] | --promote | --rollback');
  process.exit(2);
};
if (!values.tenant || !values.slug || !['auto', 'live', 'preview'].includes(values.channel)) usage();
const adapters = { local: localAdapter, command: commandAdapter };
if (!Object.hasOwn(adapters, values.adapter)) usage();
const adapter = adapters[values.adapter]();
installRejectionGuard();

if (values.promote) {
  const sha = adapter.promote(values.tenant, values.slug);
  console.log(JSON.stringify({ status: 'live', tenant: values.tenant, slug: values.slug, sha256: sha }));
  process.exit(0);
}
if (values.rollback) {
  console.log(`rolled back ${values.tenant}/${values.slug}; now serving ${adapter.rollback(values.tenant, values.slug) ?? 'nothing'}`);
  process.exit(0);
}
if (process.env.OPENPEARL_SIGNING_KEY_FILE) process.env.OPENPEARL_SIGNING_KEY = readFileSync(process.env.OPENPEARL_SIGNING_KEY_FILE, 'utf8');
if (!values.commit || !process.env.OPENPEARL_SIGNING_KEY) usage();

const policies = loadJson(new URL('../framework/core/policies.json', import.meta.url));
const entitlements = loadJson(new URL('../framework/core/entitlements.json', import.meta.url));
const ext = loadExtension(join(values.repo, 'tenants', values.tenant, 'extensions', values.slug));
const bundle = signBundle(
  createBundle({ tenant: values.tenant, slug: values.slug, manifest: ext.manifest, source: ext.source, commit: values.commit }),
  process.env.OPENPEARL_SIGNING_KEY,
);

// Smoke test the exact signed artifact: it must verify, install and answer every route without a denial
const smoke = async () => {
  const store = createStore(policies);
  const publicKey = createPublicKey(process.env.OPENPEARL_SIGNING_KEY).export({ type: 'spki', format: 'pem' });
  const runtime = createRuntime({ store, policies, entitlements, publicKey });
  try {
    runtime.install(bundle);
    const session = store.session({ tenant: values.tenant, user: 'smoke', roles: [] });
    for (const r of bundle.manifest.routes) {
      const res = await runtime.handle({ session, slug: values.slug, method: r.method, path: r.path });
      if (res.audit.denied.length) throw new Error(`${r.method} ${r.path}: ${res.audit.denied[0].reason}`);
      if (res.status === 503 || res.status === 404) throw new Error(`${r.method} ${r.path} returned ${res.status}`);
    }
  } finally {
    await runtime.close();
  }
};

try {
  await smoke();
} catch (e) {
  console.error(`Smoke test failed; not deployed: ${e.message}`);
  process.exit(1);
}
const plan = entitlements.plans[entitlements.tenants[values.tenant]?.plan] ?? {};
const writes = ext.manifest.capabilities.some((c) => c.startsWith('data:write:'));
const channel = values.channel === 'auto' ? (plan.previewRequired || writes ? 'preview' : 'live') : values.channel;
adapter.stage(bundle);
try {
  if (channel === 'preview') adapter.preview(bundle);
  else adapter.enable(bundle);
} catch (e) {
  // The previous version (if any) is still the one being served
  console.error(`${channel === 'preview' ? 'Preview' : 'Enable'} failed; previous version still live: ${e.message}`);
  process.exit(1);
}
console.log(JSON.stringify({ status: channel === 'preview' ? 'preview' : 'live', tenant: values.tenant, slug: values.slug, commit: values.commit, sha256: bundle.sha256 }));
