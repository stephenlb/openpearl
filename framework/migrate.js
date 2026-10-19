#!/usr/bin/env node
// Usage: OPENPEARL_ADMIN_DATABASE_URL=postgres://... [OPENPEARL_APP_PASSWORD=...] node framework/migrate.js [--app-password <pw>]
// Applies framework/core/postgres.sql and syncs collections from policies.json.
// Run as a privileged role; the runtime then connects as openpearl_app.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { loadJson } from './core/extension.js';

const { values } = parseArgs({ options: { 'app-password': { type: 'string' } } });
const url = process.env.OPENPEARL_ADMIN_DATABASE_URL;
if (!url) {
  console.error('OPENPEARL_ADMIN_DATABASE_URL is required');
  process.exit(2);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(readFileSync(new URL('./core/postgres.sql', import.meta.url), 'utf8'));
  for (const [name, p] of Object.entries(loadJson(new URL('./core/policies.json', import.meta.url)))) {
    await client.query('insert into openpearl_collections (name, visibility) values ($1, $2) on conflict (name) do update set visibility = excluded.visibility', [name, p.visibility]);
  }
  const password = values['app-password'] ?? process.env.OPENPEARL_APP_PASSWORD;
  if (password) {
    await client.query(`alter role openpearl_app password ${client.escapeLiteral(password)}`);
  }
  console.log('migrated');
} finally {
  await client.end();
}
