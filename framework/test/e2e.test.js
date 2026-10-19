// End to end on the local adapter: gates on a real git change, isolation CLI,
// signed deploy, the reference host serving it, tenant separation, tampering and rollback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const node = (args, opts = {}) => execFileSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8', ...opts });
const tryNode = (args, opts) => {
  try {
    return { code: 0, out: node(args, { stdio: 'pipe', ...opts }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout) };
  }
};

function candidateRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'openpearl-repo-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), 'base\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  const ext = join(dir, 'tenants/acme/extensions/order-summary');
  mkdirSync(ext, { recursive: true });
  cpSync(join(repoRoot, 'evals/corpus/extensions/benign-order-summary/ext'), ext, { recursive: true });
  return { dir, git, ext };
}

test('gates CLI passes a clean extension change and blocks a core edit or a symlink', () => {
  const { dir, git } = candidateRepo();
  const gates = (slug = 'order-summary') => tryNode(['framework/gates.js', '--tenant', 'acme', '--slug', slug, '--base', 'main', '--repo', dir]);
  assert.equal(gates().code, 0, gates().out);
  writeFileSync(join(dir, 'README.md'), 'changed\n');
  assert.match(gates().out, /path outside the extension/);
  git('checkout', '--', 'README.md');
  symlinkSync('/etc/passwd', join(dir, 'tenants/acme/extensions/order-summary/README.md'));
  assert.match(gates().out, /regular, non-executable file/);
});

test('isolation CLI exits non-zero for a leaky extension', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'openpearl-iso-')), 'share-notes');
  cpSync(join(repoRoot, 'evals/corpus/extensions/attack-launder-notes/ext'), dir, { recursive: true });
  const r = tryNode(['isolation/run.js', '--tenant', 'acme', '--dir', dir]);
  assert.equal(r.code, 1);
  assert.ok(JSON.parse(r.out).violations.length > 0);
});

test('signed deploy goes live for the requesting tenant only, tampering is refused, rollback works', async () => {
  const { dir } = candidateRepo();
  const registry = mkdtempSync(join(tmpdir(), 'openpearl-reg-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const env = { ...process.env, OPENPEARL_REGISTRY_DIR: registry, OPENPEARL_SIGNING_KEY: privateKey };
  const deploy = (commit) => JSON.parse(node(['deploy/cli.js', '--tenant', 'acme', '--slug', 'order-summary', '--commit', commit, '--repo', dir], { env }));
  assert.equal(deploy('c1').status, 'live');

  const seed = join(registry, 'seed.json');
  writeFileSync(seed, JSON.stringify([
    { tenant: 'acme', collection: 'orders', owner: 'alice', doc: { amount: 5 } },
    { tenant: 'acme', collection: 'orders', owner: 'bob', doc: { amount: 7 } },
    { tenant: 'beta', collection: 'orders', owner: 'eve', doc: { amount: 1000 } },
  ]));
  const sha = (t) => createHash('sha256').update(t).digest('hex');
  const tokens = {
    [sha('acme-alice-token-123')]: { tenant: 'acme', user: 'alice' },
    [sha('acme-admin-token-123')]: { tenant: 'acme', user: 'root', roles: ['admin'] },
    [sha('beta-eve-token-12345')]: { tenant: 'beta', user: 'eve' },
  };
  const port = 20000 + Math.floor(Math.random() * 20000);
  const host = spawn(process.execPath, ['framework/serve.js'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), OPENPEARL_REGISTRY_DIR: registry, OPENPEARL_WATCH_MIN_REQUESTS: '3', OPENPEARL_VERIFY_KEY: publicKey, OPENPEARL_SERVE_TOKENS: JSON.stringify(tokens), OPENPEARL_SEED: seed },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((r) => host.stdout.once('data', r));
  const call = (token, path, method = 'GET', body) =>
    fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) })
      .then(async (r) => ({ status: r.status, body: await r.json() }));
  const get = (token) => call(token, '/ext/order-summary/summary');
  try {
    assert.deepEqual(await get('acme-alice-token-123'), { status: 200, body: { count: 2, total: 12 } });
    assert.equal((await get('beta-eve-token-12345')).status, 404);
    assert.equal((await get('not-a-valid-token-at-all')).status, 401);

    // A second version, then roll it back
    writeFileSync(join(dir, 'tenants/acme/extensions/order-summary/index.js'), "openpearl.route('GET', '/summary', () => 'v2');\n");
    deploy('c2');
    assert.equal((await get('acme-alice-token-123')).body, 'v2');
    node(['deploy/cli.js', '--rollback', '--tenant', 'acme', '--slug', 'order-summary'], { env });
    assert.deepEqual((await get('acme-alice-token-123')).body, { count: 2, total: 12 });

    // Tampering with the live bundle on disk is refused by signature verification
    const entry = join(registry, 'acme/order-summary');
    const live = JSON.parse(readFileSync(join(entry, 'history.json'), 'utf8')).at(-1);
    const bundle = JSON.parse(readFileSync(join(entry, `${live}.json`), 'utf8'));
    const forged = { ...bundle, source: "openpearl.route('GET', '/summary', () => 'evil');", sha256: 'f'.repeat(64) };
    writeFileSync(join(entry, `${forged.sha256}.json`), JSON.stringify(forged));
    writeFileSync(join(entry, 'history.json'), JSON.stringify([forged.sha256]));
    assert.equal((await get('acme-alice-token-123')).status, 503);

    // A release that keeps failing is rolled back by the live monitor
    writeFileSync(join(entry, 'history.json'), JSON.stringify([live]));
    writeFileSync(join(dir, 'tenants/acme/extensions/order-summary/index.js'), "openpearl.route('GET', '/summary', () => { throw new Error('boom'); });\n");
    deploy('c3');
    for (let i = 0; i < 3; i++) assert.equal((await get('acme-alice-token-123')).status, 500);
    assert.deepEqual((await get('acme-alice-token-123')).body, { count: 2, total: 12 });

    // An extension that writes data goes to preview first: admins only, read-only data, live after promote
    const notes = join(dir, 'tenants/acme/extensions/add-note');
    mkdirSync(notes, { recursive: true });
    writeFileSync(join(notes, 'manifest.json'), JSON.stringify({ version: 1, name: 'add-note', description: 'Add a note.', routes: [{ method: 'POST', path: '/note' }], capabilities: ['data:write:notes'] }));
    writeFileSync(join(notes, 'index.js'), "openpearl.route('POST', '/note', (req) => openpearl.data.insert('notes', { title: String(req.body && req.body.title) }).title);\n");
    const out = JSON.parse(node(['deploy/cli.js', '--tenant', 'acme', '--slug', 'add-note', '--commit', 'n1', '--repo', dir], { env }));
    assert.equal(out.status, 'preview');
    assert.equal((await call('acme-alice-token-123', '/ext/add-note/note', 'POST', { title: 'x' })).status, 404);
    assert.equal((await call('acme-alice-token-123', '/preview/ext/add-note/note', 'POST', { title: 'x' })).status, 403);
    const tried = await call('acme-admin-token-123', '/preview/ext/add-note/note', 'POST', { title: 'x' });
    assert.match(tried.body.error, /disabled in preview/);
    node(['deploy/cli.js', '--promote', '--tenant', 'acme', '--slug', 'add-note'], { env });
    assert.deepEqual(await call('acme-alice-token-123', '/ext/add-note/note', 'POST', { title: 'hello' }), { status: 200, body: 'hello' });

    // Kill switch
    writeFileSync(join(entry, 'history.json'), JSON.stringify([live]));
    writeFileSync(join(entry, 'disabled'), '');
    assert.equal((await get('acme-alice-token-123')).status, 503);
    assert.ok(readdirSync(entry).length >= 3);
  } finally {
    host.kill();
  }
});
