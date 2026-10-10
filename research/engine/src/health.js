// Health checks: register named async checks, run them all and aggregate.
// status: 'ok' if every check passes (or none registered), 'down' if every
// check fails, 'degraded' otherwise. A check still pending after timeoutMs
// (default 5000, 0 disables) counts as a failure.
export function createHealth({ now = Date.now, timeoutMs = 5000 } = {}) {
  const checks = new Map();

  function register(name, checkFn) {
    if (typeof name !== 'string' || name === '') throw new TypeError('name must be a non-empty string');
    if (typeof checkFn !== 'function') throw new TypeError('checkFn must be a function');
    if (checks.has(name)) throw new Error(`check already registered: ${name}`);
    checks.set(name, checkFn);
  }

  async function run() {
    const results = new Map();
    await Promise.all([...checks].map(async ([name, fn]) => {
      const start = now();
      let timer;
      try {
        const pending = (async () => fn())();
        const res = timeoutMs > 0
          ? await Promise.race([
            pending,
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error(`check timed out after ${timeoutMs}ms`)), timeoutMs);
            }),
          ])
          : await pending;
        // A check returning exactly `false` counts as a failure.
        results.set(name, res === false
          ? { ok: false, ms: now() - start, error: 'check returned false' }
          : { ok: true, ms: now() - start, error: null });
      } catch (err) {
        results.set(name, { ok: false, ms: now() - start, error: err instanceof Error ? err.message : String(err) });
      } finally {
        clearTimeout(timer);
      }
    }));
    // Keep registration order in the output. fromEntries defines own keys, so a
    // check named "__proto__" is kept.
    const ordered = Object.fromEntries([...checks.keys()].map((name) => [name, results.get(name)]));
    const list = Object.values(ordered);
    const failed = list.filter((c) => !c.ok).length;
    const status = failed === 0 ? 'ok' : failed === list.length ? 'down' : 'degraded';
    return { status, checks: ordered };
  }

  return { register, run };
}
