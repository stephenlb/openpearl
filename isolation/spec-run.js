#!/usr/bin/env node
// Usage: node isolation/spec-run.js --tenant <id> --dir <extension dir> --spec <file> [--spec <file> ...] [--out result.json]
// Missing spec files are skipped (e.g. no committed regression spec yet); at least one must exist.
// Exit codes: 0 = all cases pass, 1 = a case failed or a spec is invalid, 2 = usage or load error.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadExtension, loadJson } from '../framework/core/extension.js';
import { installRejectionGuard } from '../framework/runtime/sandbox.js';
import { runSpecs } from './spec.js';

const { values } = parseArgs({ options: { tenant: { type: 'string' }, dir: { type: 'string' }, spec: { type: 'string', multiple: true }, out: { type: 'string' } } });
if (!values.tenant || !values.dir || !values.spec?.length) {
  console.error('Usage: node isolation/spec-run.js --tenant <id> --dir <extension dir> --spec <file> [--spec <file> ...] [--out result.json]');
  process.exit(2);
}
installRejectionGuard();
let extension;
let specs;
try {
  extension = loadExtension(values.dir);
  specs = values.spec.filter((f) => existsSync(f)).map((f) => JSON.parse(readFileSync(f, 'utf8')));
} catch (e) {
  console.error(`Could not load: ${e.message}`);
  process.exit(2);
}
if (!specs.length) {
  console.error('No spec files found');
  process.exit(2);
}
const report = await runSpecs({
  tenant: values.tenant,
  extension,
  specs,
  policies: loadJson(new URL('../framework/core/policies.json', import.meta.url)),
  entitlements: loadJson(new URL('../framework/core/entitlements.json', import.meta.url)),
});
const text = JSON.stringify(report, null, 2);
if (values.out) writeFileSync(values.out, `${text}\n`);
console.log(text);
process.exit(report.status === 'pass' ? 0 : 1);
