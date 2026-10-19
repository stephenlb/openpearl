// Reads an extension directory (tenants/<tenant>/extensions/<slug>/).
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

// Files an extension directory may contain; anything else is rejected by the gates.
export const ALLOWED_FILES = new Set(['manifest.json', 'index.js', 'README.md']);

export function loadExtension(dir) {
  const slug = basename(dir);
  return {
    slug,
    manifest: JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')),
    source: readFileSync(join(dir, 'index.js'), 'utf8'),
  };
}

export function loadJson(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}
