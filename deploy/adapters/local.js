// Local registry adapter: signed bundles on disk, read by framework/serve.js.
// Layout: <root>/<tenant>/<slug>/<sha256>.json, history.json (live versions, newest last) and
// preview.json (the sha256 waiting for a tenant admin's approval).
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export function localAdapter({ root = process.env.OPENPEARL_REGISTRY_DIR || '.openpearl-registry' } = {}) {
  const dir = (tenant, slug) => join(root, tenant, slug);
  const history = (tenant, slug) => {
    const f = join(dir(tenant, slug), 'history.json');
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
  };
  // Atomic replace so a reader never sees a half-written pointer
  const writeHistory = (tenant, slug, list) => {
    const f = join(dir(tenant, slug), 'history.json');
    writeFileSync(`${f}.tmp`, JSON.stringify(list));
    renameSync(`${f}.tmp`, f);
  };
  return {
    stage(bundle) {
      mkdirSync(dir(bundle.tenant, bundle.slug), { recursive: true });
      writeFileSync(join(dir(bundle.tenant, bundle.slug), `${bundle.sha256}.json`), JSON.stringify(bundle));
    },
    enable(bundle) {
      writeHistory(bundle.tenant, bundle.slug, [...history(bundle.tenant, bundle.slug).filter((h) => h !== bundle.sha256), bundle.sha256]);
    },
    rollback(tenant, slug) {
      const list = history(tenant, slug);
      list.pop();
      writeHistory(tenant, slug, list);
      return list.at(-1) ?? null;
    },
    // Preview channel: one staged version per extension that tenant admins can try before it goes live
    preview(bundle) {
      writeFileSync(join(dir(bundle.tenant, bundle.slug), 'preview.json'), JSON.stringify(bundle.sha256));
    },
    promote(tenant, slug) {
      const f = join(dir(tenant, slug), 'preview.json');
      if (!existsSync(f)) throw new Error(`no preview for ${tenant}/${slug}`);
      const sha = JSON.parse(readFileSync(f, 'utf8'));
      writeHistory(tenant, slug, [...history(tenant, slug).filter((h) => h !== sha), sha]);
      rmSync(f);
      return sha;
    },
    history,
    get(tenant, slug, sha) {
      const f = join(dir(tenant, slug), `${sha}.json`);
      return /^[0-9a-f]{64}$/.test(sha) && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
    },
    previewSha(tenant, slug) {
      const f = join(dir(tenant, slug), 'preview.json');
      return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
    },
    current(tenant, slug) {
      const sha = history(tenant, slug).at(-1);
      return sha ? JSON.parse(readFileSync(join(dir(tenant, slug), `${sha}.json`), 'utf8')) : null;
    },
  };
}
