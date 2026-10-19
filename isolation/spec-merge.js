#!/usr/bin/env node
// Usage: node isolation/spec-merge.js <existing.json|missing> <new.json> <out.json>
// Combines the committed regression spec with a newly accepted one: new cases
// replace same-named old ones, and the newest 50 are kept.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { MAX_CASES } from './spec.js';

const [oldFile, newFile, out] = process.argv.slice(2);
if (!newFile || !out) {
  console.error('Usage: node isolation/spec-merge.js <existing.json|missing> <new.json> <out.json>');
  process.exit(2);
}
const old = existsSync(oldFile) ? JSON.parse(readFileSync(oldFile, 'utf8')).cases : [];
const added = JSON.parse(readFileSync(newFile, 'utf8')).cases;
const names = new Set(added.map((c) => c.name));
const cases = [...old.filter((c) => !names.has(c.name)), ...added].slice(-MAX_CASES);
writeFileSync(out, `${JSON.stringify({ version: 1, cases }, null, 2)}\n`);
