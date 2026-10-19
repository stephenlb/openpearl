#!/usr/bin/env node
// Usage: node isolation/run.js --tenant <id> --dir <extension dir> [--out result.json]
// Exit codes: 0 = pass, 1 = isolation failure, 2 = usage or load error.
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadExtension, loadJson } from '../framework/core/extension.js';
import { installRejectionGuard } from '../framework/runtime/sandbox.js';
import { runIsolation } from './harness.js';

const { values } = parseArgs({ options: { tenant: { type: 'string' }, dir: { type: 'string' }, out: { type: 'string' } } });
if (!values.tenant || !values.dir) {
  console.error('Usage: node isolation/run.js --tenant <id> --dir <extension dir> [--out result.json]');
  process.exit(2);
}
installRejectionGuard();
let extension;
try {
  extension = loadExtension(values.dir);
} catch (e) {
  console.error(`Could not load extension: ${e.message}`);
  process.exit(2);
}
const report = await runIsolation({
  tenant: values.tenant,
  extension,
  policies: loadJson(new URL('../framework/core/policies.json', import.meta.url)),
  entitlements: loadJson(new URL('../framework/core/entitlements.json', import.meta.url)),
});
const text = JSON.stringify(report, null, 2);
if (values.out) writeFileSync(values.out, `${text}\n`);
console.log(text);
process.exit(report.status === 'pass' ? 0 : 1);
