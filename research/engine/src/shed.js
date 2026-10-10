// Load shedder. Tracks queue depth (admit() ... done()) and an EWMA of observed
// latency. Load = max(depth / maxQueue, latency / maxLatencyMs). Below 1 all work
// is admitted; above it the lowest priorities are rejected first: with `priority`
// levels (0 = lowest, levels - 1 = highest), levels below
// 1 + floor((load - 1) * levels) are shed, capped at levels - 1 so the top level
// is always admitted (this keeps latency observable and lets the EWMA recover). admit() is non-blocking and returns
// { admitted, reason?, load }. Deterministic: no clock or RNG needed.
export function createShedder({ maxQueue, maxLatencyMs = Infinity, priority = 3, alpha = 0.2 } = {}) {
  if (!(Number.isInteger(maxQueue) && maxQueue >= 1)) throw new RangeError('maxQueue must be a positive integer');
  if (!(maxLatencyMs > 0)) throw new RangeError('maxLatencyMs must be > 0');
  if (!(Number.isInteger(priority) && priority >= 1)) throw new RangeError('priority must be a positive integer (number of levels)');
  if (!(Number.isFinite(alpha) && alpha > 0 && alpha <= 1)) throw new RangeError('alpha must be in (0, 1]');
  let depth = 0;
  let latency = null;
  const stats = { admitted: 0, shed: 0 };

  const queueLoad = () => depth / maxQueue;
  const latencyLoad = () => (latency === null ? 0 : latency / maxLatencyMs);
  const load = () => Math.max(queueLoad(), latencyLoad());

  return {
    // `level` is the work's priority in [0, levels - 1]; higher is more important.
    admit(level = priority - 1) {
      if (!(Number.isInteger(level) && level >= 0 && level < priority)) throw new RangeError('level out of range');
      const l = load();
      const cutoff = l < 1 ? 0 : Math.min(priority - 1, 1 + Math.floor((l - 1) * priority));
      if (level < cutoff) {
        stats.shed += 1;
        return { admitted: false, reason: queueLoad() >= latencyLoad() ? 'queue' : 'latency', load: l };
      }
      depth += 1;
      stats.admitted += 1;
      return { admitted: true, load: l };
    },
    // Marks one admitted item finished, optionally recording its latency.
    done(latencyMs) {
      if (depth === 0) throw new Error('done() without matching admit()');
      if (latencyMs !== undefined && !(Number.isFinite(latencyMs) && latencyMs >= 0)) throw new RangeError('latencyMs must be a non-negative number');
      depth -= 1;
      if (latencyMs !== undefined) latency = latency === null ? latencyMs : alpha * latencyMs + (1 - alpha) * latency;
    },
    get depth() { return depth; },
    get latency() { return latency; },
    get load() { return load(); },
    stats() { return { ...stats }; },
  };
}
