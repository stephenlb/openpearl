// Runs every case in evals/corpus/extensions through the merge gates and the
// isolation harness. Every attack must be stopped by at least one layer, and
// benign extensions must pass both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { checkChange } from '../gates.js';
import { loadJson } from '../core/extension.js';
import { runIsolation } from '../../isolation/harness.js';
import { installRejectionGuard } from '../runtime/sandbox.js';
import { runSpecs } from '../../isolation/spec.js';
import { existsSync } from 'node:fs';

const root = new URL('../../evals/corpus/extensions/', import.meta.url);
const policies = loadJson(new URL('../core/policies.json', import.meta.url));
const entitlements = loadJson(new URL('../core/entitlements.json', import.meta.url));
installRejectionGuard();

for (const name of readdirSync(root).sort()) {
  const spec = loadJson(new URL(`${name}/case.json`, root));
  const file = (f) => readFileSync(new URL(`${name}/ext/${f}`, root), 'utf8');
  const dir = `tenants/${spec.tenant}/extensions/${spec.slug}/`;

  test(`${name}: ${spec.about}`, async () => {
    const changes = [
      ...['manifest.json', 'index.js'].map((f) => ({ status: 'A', mode: spec.modes?.[f] ?? '100644', path: dir + f })),
      ...(spec.extraChanges ?? []),
    ];
    const gateErrors = checkChange({
      tenant: spec.tenant,
      slug: spec.slug,
      changes,
      read: (path) => file(path.slice(dir.length)),
      list: () => [spec.slug],
      addedLines: file('index.js').split('\n').length,
      policies,
      entitlements,
    });
    const isolation = await runIsolation({
      tenant: spec.tenant,
      extension: { slug: spec.slug, manifest: JSON.parse(file('manifest.json')), source: file('index.js') },
      policies,
      entitlements,
    });
    const gates = gateErrors.length ? 'fail' : 'pass';
    assert.equal(gates, spec.expect.gates, `gates: ${JSON.stringify(gateErrors)}`);
    assert.equal(isolation.status, spec.expect.isolation, `isolation: ${JSON.stringify({ ...isolation, violations: isolation.violations.slice(0, 3) })}`);
    if (name.startsWith('attack-')) assert.ok(gates === 'fail' || isolation.status === 'fail', 'an attack must be stopped by at least one layer');
    if (name.startsWith('benign-')) assert.equal(isolation.invocations > 0, true);
    // Benign cases with an acceptance spec must also do what they claim
    if (existsSync(new URL(`${name}/spec.json`, root))) {
      const report = await runSpecs({
        tenant: spec.tenant,
        extension: { slug: spec.slug, manifest: JSON.parse(file('manifest.json')), source: file('index.js') },
        specs: [loadJson(new URL(`${name}/spec.json`, root))],
        policies,
        entitlements,
      });
      assert.equal(report.status, 'pass', JSON.stringify(report.errors.length ? report.errors : report.cases));
    }
  });
}
