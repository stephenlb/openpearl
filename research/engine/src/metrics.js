// Metrics recorder: counters and histograms with a deterministic snapshot.

// Nearest-rank percentile over an ascending-sorted array.
function percentile(sorted, p) {
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

export function createMetrics() {
  const counters = new Map();
  const histograms = new Map();

  return {
    inc(name, n = 1) {
      counters.set(name, (counters.get(name) ?? 0) + n);
    },
    observe(name, value) {
      if (!histograms.has(name)) histograms.set(name, []);
      histograms.get(name).push(value);
    },
    snapshot() {
      const outCounters = {};
      for (const [name, v] of counters) outCounters[name] = v;
      const outHistograms = {};
      for (const [name, values] of histograms) {
        const sorted = [...values].sort((a, b) => a - b);
        const sum = sorted.reduce((a, b) => a + b, 0);
        outHistograms[name] = {
          count: sorted.length,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          mean: sum / sorted.length,
          p50: percentile(sorted, 50),
          p95: percentile(sorted, 95),
          p99: percentile(sorted, 99),
        };
      }
      return { counters: outCounters, histograms: outHistograms };
    },
  };
}
