import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCheckpointStore } from '../src/index.js';

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-ckpt-'));
  return { dir, file: path.join(dir, 'sub', 'ckpt.json') };
}

function enoentFs(overrides) {
  return {
    readFileSync() { const e = new Error('nope'); e.code = 'ENOENT'; throw e; },
    mkdirSync() {},
    writeFileSync() {},
    renameSync() {},
    ...overrides,
  };
}

test('memory-only store saves, loads and clears', () => {
  const s = createCheckpointStore();
  assert.equal(s.load('a'), undefined);
  s.save('a', { n: 1 });
  assert.deepEqual(s.load('a'), { n: 1 });
  assert.equal(s.clear('a'), true);
  assert.equal(s.clear('a'), false);
  assert.equal(s.load('a'), undefined);
});

test('returned state is a copy', () => {
  const s = createCheckpointStore();
  const st = { n: [1] };
  s.save('a', st);
  st.n.push(2);
  s.load('a').n.push(3);
  assert.deepEqual(s.load('a'), { n: [1] });
});

test('persists to file and reloads', () => {
  const { dir, file } = tmpFile();
  try {
    const s = createCheckpointStore({ path: file });
    s.save('a', { n: 1 });
    s.save('b', [1, 2]);
    s.clear('b');
    const s2 = createCheckpointStore({ path: file });
    assert.deepEqual(s2.load('a'), { n: 1 });
    assert.equal(s2.load('b'), undefined);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['ckpt.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('write goes through tmp file then rename', () => {
  const calls = [];
  const fake = enoentFs({
    writeFileSync(p) { calls.push(['write', p]); },
    renameSync(a, b) { calls.push(['rename', a, b]); },
  });
  createCheckpointStore({ path: '/x/c.json', fs: fake }).save('k', 1);
  assert.deepEqual(calls, [['write', '/x/c.json.tmp'], ['rename', '/x/c.json.tmp', '/x/c.json']]);
});

test('failed write rolls back in-memory state', () => {
  const fake = enoentFs({ writeFileSync() { throw new Error('disk full'); } });
  const s = createCheckpointStore({ path: '/x/c.json', fs: fake });
  assert.throws(() => s.save('k', 1), /disk full/);
  assert.equal(s.load('k'), undefined);
});

test('corrupt file and bad args throw', () => {
  const { dir, file } = tmpFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '[1]');
    assert.throws(() => createCheckpointStore({ path: file }), /invalid checkpoint file/);
    fs.writeFileSync(file, '{oops');
    assert.throws(() => createCheckpointStore({ path: file }), SyntaxError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const s = createCheckpointStore();
  assert.throws(() => s.save('', 1), TypeError);
  assert.throws(() => s.save('a', undefined), TypeError);
  assert.throws(() => createCheckpointStore({ path: '' }), TypeError);
});

test('special keys like __proto__ are safe', () => {
  const { dir, file } = tmpFile();
  try {
    const s = createCheckpointStore({ path: file });
    s.save('__proto__', { x: 1 });
    assert.deepEqual(createCheckpointStore({ path: file }).load('__proto__'), { x: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
