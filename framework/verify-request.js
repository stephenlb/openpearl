#!/usr/bin/env node
// Usage: OPENPEARL_INTAKE_KEY=... ISSUE_BODY=... node framework/verify-request.js <out-dir>
// Writes request.json and request.md (the customer's text) and prints GitHub
// output lines (tenant=, slug=, id=). Exit 1 if the request is not authentic.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyRequest } from './core/request.js';

const out = process.argv[2];
if (!out) {
  console.error('Usage: node framework/verify-request.js <out-dir>');
  process.exit(2);
}
let req;
try {
  req = verifyRequest(process.env.ISSUE_BODY ?? '', process.env.OPENPEARL_INTAKE_KEY);
} catch (e) {
  console.error(`Rejected: ${e.message}`);
  process.exit(1);
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'request.json'), `${JSON.stringify(req, null, 2)}\n`);
writeFileSync(join(out, 'request.md'), `${req.text}\n`);
console.log(`tenant=${req.tenant}\nslug=${req.slug}\nid=${req.id}`);
