import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeOnly, scanSource, parseRaw } from '../gates.js';

test('banned words in strings and comments do not trip the scan', () => {
  const src = [
    "// this uses fetch in a comment",
    "/* process.env */",
    "const a = 'this order'; const b = \"constructor\"; const c = `await ${'x'}`;",
    "const r = /ord|'/g;",
    "openpearl.route('GET', '/x', () => a + b + c + r.source);",
  ].join('\n');
  assert.deepEqual(scanSource(src), []);
});

test('banned identifiers in code and template expressions are caught', () => {
  assert.match(scanSource("openpearl.route('GET', '/x', () => this);")[0], /forbidden identifiers: this/);
  assert.match(scanSource("const s = `${globalThis.x}`;")[0], /globalThis/);
  assert.match(scanSource("const s = `a ${`b ${process}`} c`;")[0], /process/);
  assert.match(scanSource("const x = 1 / 2; const y = fetch;")[0], /fetch/);
});

test('a quote inside a regex cannot hide the code after it', () => {
  assert.match(scanSource("const r = /'/; const p = process;")[0], /process/);
  assert.match(scanSource("const r = /[/']/; const p = process;")[0], /process/);
});

test('escapes outside strings, import and unparsable code are rejected', () => {
  assert.match(scanSource('const \\u0061 = 1;').join(), /escapes/);
  assert.match(scanSource("import('fs')").join(), /may not use import/);
  assert.match(scanSource('openpearl.route(').join(), /does not parse/);
});

test('codeOnly keeps line structure', () => {
  const src = "a\n'b\\\nc'\n/* d\ne */ f";
  assert.equal(codeOnly(src).split('\n').length, src.split('\n').length);
});

test('parseRaw reads modes, status and paths', () => {
  const raw = ':000000 100644 0000000 1111111 A\0tenants/acme/extensions/x/index.js\0:100644 120000 2222222 3333333 T\0tenants/acme/extensions/x/manifest.json\0';
  assert.deepEqual(parseRaw(raw), [
    { status: 'A', mode: '100644', path: 'tenants/acme/extensions/x/index.js' },
    { status: 'T', mode: '120000', path: 'tenants/acme/extensions/x/manifest.json' },
  ]);
});

test('regex bodies are still scanned, so a division mistaken for a regex hides nothing', () => {
  assert.match(scanSource("let a = 1; a = a + / process /.source.length;").join(), /process/);
});
