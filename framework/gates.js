#!/usr/bin/env node
// Deterministic merge gates for a tenant extension change.
// Usage: node framework/gates.js --tenant <id> --slug <slug> --base <ref> [--repo <dir>] [--out result.json]
// Exit codes: 0 = pass, 1 = blocked, 2 = usage error.
//
// Run from a trusted copy (the default branch), never from the candidate tree.
// The runtime sandbox is the security boundary; these checks keep anything
// outside the tenant's own extension directory from merging, and reject code
// that reaches for sandbox internals so it never gets that far.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { validateManifest, unentitled, planFor, TENANT, SLUG } from './core/manifest.js';
import { ALLOWED_FILES, loadJson } from './core/extension.js';
import { checkSource } from './runtime/sandbox.js';

export const MAX_ADDED_LINES = 400;
const MAX_README = 20_000;

// Identifiers with no legitimate use in an extension (see framework/EXTENSIONS.md)
const BANNED = new Set([
  'eval', 'Function', 'constructor', 'prototype', '__proto__', 'globalThis', 'global', 'this', 'arguments', 'with',
  'process', 'require', 'module', 'exports', 'import', 'Reflect', 'Proxy', 'WebAssembly', 'SharedArrayBuffer',
  'Atomics', 'Symbol', 'fetch', 'XMLHttpRequest', 'WebSocket', 'setTimeout', 'setInterval', 'queueMicrotask',
  'Promise', 'async', 'await', 'getPrototypeOf', 'setPrototypeOf', 'defineProperty', 'defineProperties',
  'getOwnPropertyDescriptor', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__', 'debugger',
]);

const SECRETS = [
  /AKIA[0-9A-Z]{16}/, /gh[pousr]_[A-Za-z0-9]{36,}/, /github_pat_[A-Za-z0-9_]{40,}/, /sk-[A-Za-z0-9_-]{20,}/,
  /xox[abprs]-[A-Za-z0-9-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /AIza[0-9A-Za-z_-]{35}/,
];

// Replaces comments and string/template/regex literal contents with spaces so
// banned words in text don't trip the scan; template `${}` bodies stay code.
export function codeOnly(src) {
  let out = '';
  let i = 0;
  const braces = []; // template nesting: brace depth at each `${`
  let depth = 0;
  let prev = ''; // last significant code character, to tell regex from division
  const regexOk = () => prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev) || /\b(return|typeof|case|in|of|void|delete|throw|new)\s*$/.test(out.slice(-12));
  const blank = () => {
    out += src[i] === '\n' ? '\n' : ' ';
    i++;
  };
  const skipQuoted = (q) => {
    out += ' ';
    i++;
    while (i < src.length && src[i] !== q && src[i] !== '\n') {
      if (src[i] === '\\') blank();
      if (i < src.length) blank();
    }
    if (src[i] === q) blank();
  };
  const template = () => {
    // at the character after ` or }
    while (i < src.length) {
      if (src[i] === '\\') { blank(); if (i < src.length) blank(); continue; }
      if (src[i] === '`') { out += ' '; i++; return; }
      if (src[i] === '$' && src[i + 1] === '{') { out += '${'; i += 2; braces.push(depth); depth++; return; }
      blank();
    }
  };
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && n === '*') { while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; } out += '  '; i += 2; continue; }
    if (c === '"' || c === "'") { skipQuoted(c); prev = '"'; continue; }
    if (c === '`') { out += ' '; i++; template(); prev = '"'; continue; }
    if (c === '/' && regexOk()) {
      // Regex bodies stay visible to the scan (only quotes are blanked), so
      // mistaking a division for a regex can't hide code
      out += c;
      i++;
      let cls = false;
      while (i < src.length && src[i] !== '\n' && (cls || src[i] !== '/')) {
        if (src[i] === '\\') blank();
        else if (src[i] === '[') cls = true;
        else if (src[i] === ']') cls = false;
        if (i < src.length) {
          out += '\'"`'.includes(src[i]) ? ' ' : src[i];
          i++;
        }
      }
      if (src[i] === '/') blank();
      prev = '"';
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (braces.length && depth === braces.at(-1)) { braces.pop(); out += '}'; i++; template(); prev = '"'; continue; }
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

export function scanSource(source) {
  const errors = [];
  const bad = checkSource(source);
  if (bad) errors.push(bad);
  try {
    new vm.Script(source, { filename: 'index.js' }); // compiles only, never runs
  } catch (e) {
    errors.push(`index.js does not parse: ${e.message}`);
    return errors;
  }
  const code = codeOnly(source);
  const found = new Set();
  for (const m of code.matchAll(/[A-Za-z_$][\w$]*/g)) if (BANNED.has(m[0])) found.add(m[0]);
  if (found.size) errors.push(`index.js uses forbidden identifiers: ${[...found].sort().join(', ')}`);
  if (/\\u|\\x/.test(code)) errors.push('index.js may not use escapes outside string literals');
  return errors;
}

// changes: [{ status, mode, path }] from `git diff --raw`; read(path) returns the new file contents.
export function checkChange({ tenant, slug, changes, read, list, addedLines, policies, entitlements }) {
  const errors = [];
  if (!TENANT.test(tenant) || !SLUG.test(slug)) return ['invalid tenant or slug'];
  const plan = planFor(tenant, entitlements);
  if (!plan) return [`unknown tenant: ${tenant}`];
  if (!changes.length) return ['the change is empty'];
  const dir = `tenants/${tenant}/extensions/${slug}/`;
  for (const { status, mode, path } of changes) {
    const name = path.startsWith(dir) ? path.slice(dir.length) : null;
    if (name === null || !ALLOWED_FILES.has(name)) {
      errors.push(`path outside the extension or not an allowed file: ${path}`);
      continue;
    }
    if (status === 'D') {
      if (name !== 'README.md') errors.push(`may not delete ${path}; removing an extension needs a human`);
    } else if (mode !== '100644') {
      errors.push(`${path} must be a regular, non-executable file (mode ${mode})`);
    }
  }
  if (addedLines > MAX_ADDED_LINES) errors.push(`change adds ${addedLines} lines (limit ${MAX_ADDED_LINES})`);
  if (errors.length) return errors;

  let manifest;
  try {
    manifest = JSON.parse(read(`${dir}manifest.json`));
  } catch (e) {
    return [`manifest.json is missing or not JSON: ${e.message}`];
  }
  errors.push(...validateManifest(manifest, { slug, policies }));
  if (Array.isArray(manifest.capabilities)) {
    const extra = unentitled(manifest.capabilities, tenant, entitlements);
    if (extra.length) errors.push(`capabilities not in the ${entitlements.tenants[tenant].plan} plan: ${extra.join(', ')}`);
  }
  const extensions = list(`tenants/${tenant}/extensions`);
  if (extensions.length > plan.maxExtensions) errors.push(`tenant has ${extensions.length} extensions (plan limit ${plan.maxExtensions})`);

  let source;
  try {
    source = read(`${dir}index.js`);
  } catch {
    return [...errors, 'index.js is missing'];
  }
  errors.push(...scanSource(source));
  let readme = '';
  try { readme = read(`${dir}README.md`); } catch { /* optional */ }
  if (readme.length > MAX_README) errors.push(`README.md exceeds ${MAX_README} characters`);
  for (const [name, text] of [['manifest.json', JSON.stringify(manifest)], ['index.js', source], ['README.md', readme]]) {
    if (SECRETS.some((re) => re.test(text))) errors.push(`${name} appears to contain a secret`);
  }
  return errors;
}

// Parses `git diff --raw -z --no-renames`: ":<srcmode> <dstmode> <src> <dst> <status>\0<path>\0"
export function parseRaw(raw) {
  const parts = raw.split('\0');
  const changes = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [, dstMode, , , status] = parts[i].replace(/^:/, '').split(' ');
    changes.push({ status: status[0], mode: dstMode, path: parts[i + 1] });
  }
  return changes;
}

function main() {
  const { values } = parseArgs({
    options: { tenant: { type: 'string' }, slug: { type: 'string' }, base: { type: 'string' }, repo: { type: 'string' }, out: { type: 'string' } },
  });
  if (!values.tenant || !values.slug || !values.base) {
    console.error('Usage: node framework/gates.js --tenant <id> --slug <slug> --base <ref> [--repo <dir>] [--out result.json]');
    process.exit(2);
  }
  const repo = values.repo ?? '.';
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
  // Compare the working tree (candidate with the patch applied, staged or not) to the base
  git('add', '-A', '--intent-to-add');
  const changes = parseRaw(git('diff', '--raw', '-z', '--no-renames', values.base));
  const addedLines = git('diff', '--numstat', values.base)
    .split('\n').filter(Boolean)
    .reduce((n, line) => n + (Number(line.split('\t')[0]) || 0), 0);
  const read = (path) => {
    const full = join(repo, path);
    if (!lstatSync(full).isFile()) throw new Error(`${path} is not a regular file`);
    return readFileSync(full, 'utf8');
  };
  const list = (path) => (existsSync(join(repo, path)) ? readdirSync(join(repo, path)).filter((d) => SLUG.test(d)) : []);
  const errors = checkChange({
    tenant: values.tenant,
    slug: values.slug,
    changes,
    read,
    list,
    addedLines,
    policies: loadJson(new URL('./core/policies.json', import.meta.url)),
    entitlements: loadJson(new URL('./core/entitlements.json', import.meta.url)),
  });
  const result = { status: errors.length ? 'fail' : 'pass', tenant: values.tenant, slug: values.slug, files: changes.map((c) => c.path), errors };
  if (values.out) writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  process.exit(errors.length ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
