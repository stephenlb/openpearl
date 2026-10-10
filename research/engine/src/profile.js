// Stage profiler: `stage(name, fn)` runs fn and adds its elapsed time (per the
// injected `now` clock, in ms) to the named stage. Sync and async fns are both
// supported and time is recorded even when fn throws or rejects. Nested stages
// each count their own full duration, so percentages are of the summed stage
// time and overlap if stages are nested.
export function createProfiler({ now = () => performance.now() } = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function');

  const stages = new Map();

  function record(name, start) {
    const elapsed = now() - start;
    const s = stages.get(name) ?? { totalMs: 0, calls: 0 };
    s.totalMs += elapsed;
    s.calls += 1;
    stages.set(name, s);
  }

  return {
    stage(name, fn) {
      if (typeof name !== 'string' || name === '') throw new TypeError('name must be a non-empty string');
      if (typeof fn !== 'function') throw new TypeError('fn must be a function');
      const start = now();
      let result;
      try {
        result = fn();
      } catch (err) {
        record(name, start);
        throw err;
      }
      if (result && typeof result.then === 'function') {
        return Promise.resolve(result).finally(() => record(name, start));
      }
      record(name, start);
      return result;
    },

    // Stages sorted by share of total time, descending (ties by name).
    report() {
      const totalMs = [...stages.values()].reduce((sum, s) => sum + s.totalMs, 0);
      const rows = [...stages].map(([name, s]) => ({
        name,
        totalMs: s.totalMs,
        calls: s.calls,
        percent: totalMs > 0 ? (s.totalMs / totalMs) * 100 : 0,
      }));
      rows.sort((a, b) => b.totalMs - a.totalMs || (a.name < b.name ? -1 : 1));
      return { totalMs, stages: rows, bottleneck: rows.length > 0 ? rows[0].name : null };
    },

    reset() {
      stages.clear();
    },
  };
}
