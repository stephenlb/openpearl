// Generic adapter: delegates to your own deploy script (Workers, Cloud Run, Lambda, k8s, ...).
// OPENPEARL_DEPLOY_COMMAND is run as: <command> <stage|enable|preview|promote|rollback> <tenant> <slug> [bundle.json]
// It must exit 0 on success. Bundles are signed; the target runtime must verify them.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function commandAdapter({ command = process.env.OPENPEARL_DEPLOY_COMMAND } = {}) {
  if (!command) throw new Error('OPENPEARL_DEPLOY_COMMAND is required for the command adapter');
  const run = (...args) => execFileSync(command, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }).trim();
  const file = (bundle) => {
    const f = join(mkdtempSync(join(tmpdir(), 'openpearl-')), 'bundle.json');
    writeFileSync(f, JSON.stringify(bundle));
    return f;
  };
  return {
    stage: (bundle) => run('stage', bundle.tenant, bundle.slug, file(bundle)),
    enable: (bundle) => run('enable', bundle.tenant, bundle.slug, file(bundle)),
    preview: (bundle) => run('preview', bundle.tenant, bundle.slug, file(bundle)),
    promote: (tenant, slug) => run('promote', tenant, slug) || null,
    rollback: (tenant, slug) => run('rollback', tenant, slug) || null,
  };
}
