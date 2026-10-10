#!/usr/bin/env node
// pearl CLI. Exit codes: 0 = ok, 1 = invalid input (bad config), 2 = usage error.
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/index.js';

const USAGE = 'Usage: pearl <version|health|config <json>>';

export function run(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'version': {
      const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
      return { code: 0, out: version };
    }
    case 'health':
      return { code: 0, out: JSON.stringify({ status: 'ok' }) };
    case 'config': {
      if (rest.length !== 1) return { code: 2, err: `config requires exactly one JSON argument\n${USAGE}` };
      let input;
      try {
        input = JSON.parse(rest[0]);
      } catch (e) {
        return { code: 1, err: `Invalid JSON: ${e.message}` };
      }
      try {
        return { code: 0, out: JSON.stringify(loadConfig(input)) };
      } catch (e) {
        return { code: 1, err: e.message };
      }
    }
    default:
      return { code: 2, err: cmd === undefined ? USAGE : `Unknown command: ${cmd}\n${USAGE}` };
  }
}

const { code, out, err } = run(process.argv.slice(2));
if (out !== undefined) process.stdout.write(`${out}\n`);
if (err !== undefined) process.stderr.write(`${err}\n`);
process.exitCode = code;
