// Health checks: register named async checks, run them all and aggregate.
// status: 'ok' if every check passes (or none registered), 'down' if every
// check fails, 'degraded' otherwise.
export function createHealth({ now = Date.now } = {}) {
  const checks = new Map();

  function register(name, checkFn) {
    if (typeof name !== 'string' || name === '') throw new TypeError('name must be a non-empty string');
    if (typeof checkFn !== 'function') throw new TypeError('checkFn must be a function');
    checks.set(name, checkFn);
  }

  async function run() {
    const results = {};
    await Promise.all([...checks].map(async ([name, fn]) => {
      const start = now();
      try {
        const res = await fn();
        // A check returning exactly `false` counts as a failure.
        results[name] = res === false
          ? { ok: false, ms: now() - start, error: 'check returned false' }
          : { ok: true, ms: now() - start, error: null };
      } catch (err) {
        results[name] = { ok: false, ms: now() - start, error: err instanceof Error ? err.message : String(err) };
      }
    }));
    // Keep registration order in the output.
    const ordered = {};
    for (const name of checks.keys()) ordered[name] = results[name];
    const list = Object.values(ordered);
    const failed = list.filter((c) => !c.ok).length;
    const status = failed === 0 ? 'ok' : failed === list.length ? 'down' : 'degraded';
    return { status, checks: ordered };
  }

  return { register, run };
}
