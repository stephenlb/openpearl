import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureSource, scanDir } from '../src/index.js';

const SAMPLE = `// header comment
function a(x) {
  if (x && x > 1) {
    for (const i of [1]) {
      return i;
    }
  }
  return 0;
}
const b = (y) => y ? 1 : 2;
`;

test('measureSource on a fixture', () => {
  const m = measureSource(SAMPLE);
  assert.equal(m.lines, 10);
  assert.equal(m.functions, 2);
  assert.equal(m.maxDepth, 3);
  assert.equal(m.cyclomatic, 5); // 1 + if, &&, for, ?
  assert.ok(Math.abs(m.commentRatio - 0.1) < 1e-9);
});

test('empty source', () => {
  assert.deepEqual(measureSource(''), { lines: 0, functions: 0, maxDepth: 0, commentRatio: 0, cyclomatic: 1 });
});

test('keywords and braces in comments and strings are ignored', () => {
  const m = measureSource('/* if { while */\nconst s = "if { && }"; // for\n');
  assert.equal(m.maxDepth, 0);
  assert.equal(m.cyclomatic, 1);
  assert.equal(m.functions, 0);
  assert.equal(m.commentRatio, 1);
});

test('unterminated quote in a regex keeps line count', () => {
  const m = measureSource('const r = /["\']/;\nconst x = 1;\n\nconst y = 2;\n');
  assert.equal(m.lines, 4);
});

test('backslash line continuation in a string keeps line count', () => {
  const m = measureSource("const s = 'a\\\nb';\nconst x = 1;\n");
  assert.equal(m.lines, 3);
});

test('??= counts as one branch', () => {
  assert.equal(measureSource('a ??= 1;').cyclomatic, 2);
});

test('multi-line template and block comment keep lines', () => {
  const m = measureSource('const t = `a\nb`;\n/* x\ny */\nconst z = 1;\n');
  assert.equal(m.lines, 5);
});

test('scanDir aggregates recursively, skipping node_modules and non-source', () => {
  const dir = mkdtempSync(join(tmpdir(), 'quality-'));
  try {
    mkdirSync(join(dir, 'sub'));
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'a.js'), SAMPLE);
    writeFileSync(join(dir, 'sub', 'b.js'), 'function f() {\n  while (1) {}\n}\n');
    writeFileSync(join(dir, 'node_modules', 'x.js'), 'function x() {}\n');
    writeFileSync(join(dir, 'notes.txt'), 'if if if');
    const r = scanDir(dir);
    assert.equal(r.files, 2);
    assert.equal(r.perFile.length, 2);
    assert.equal(r.functions, 3);
    assert.equal(r.maxDepth, 3);
    assert.equal(r.cyclomatic, 5 + 2);
    assert.equal(r.lines, 10 + 3);
    assert.ok(Math.abs(r.commentRatio - 1 / 13) < 1e-9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
