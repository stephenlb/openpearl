#!/usr/bin/env node
// Usage: node deploy/keygen.js <dir>  -> <dir>/signing.pem (secret) and <dir>/signing.pub.pem
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node deploy/keygen.js <dir>');
  process.exit(2);
}
const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
writeFileSync(join(dir, 'signing.pem'), privateKey, { mode: 0o600 });
writeFileSync(join(dir, 'signing.pub.pem'), publicKey);
console.log(`wrote ${join(dir, 'signing.pem')} and ${join(dir, 'signing.pub.pem')}`);
