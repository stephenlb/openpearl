// Micro-benchmark harness. Times each call of fn with a nanosecond clock
// (now() returns a bigint; defaults to process.hrtime.bigint) and reports
// ops/sec, mean, stddev (population) and nearest-rank p95, all in ns.
export function bench(name, fn, { iterations = 1000, warmup = 100, now = process.hrtime.bigint } = {}) {
  if (typeof fn !== 'function') throw new TypeError('fn must be a function');
  if (!(Number.isInteger(iterations) && iterations > 0)) throw new RangeError('iterations must be a positive integer');
  if (!(Number.isInteger(warmup) && warmup >= 0)) throw new RangeError('warmup must be a non-negative integer');
  for (let i = 0; i < warmup; i++) fn();
  const samples = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const start = now();
    fn();
    samples[i] = Number(now() - start);
  }
  const mean = samples.reduce((s, x) => s + x, 0) / iterations;
  const variance = samples.reduce((s, x) => s + (x - mean) ** 2, 0) / iterations;
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted[Math.min(iterations - 1, Math.max(0, Math.ceil(0.95 * iterations) - 1))];
  return {
    name,
    iterations,
    opsPerSec: mean > 0 ? 1e9 / mean : Infinity,
    mean,
    stddev: Math.sqrt(variance),
    p95,
  };
}

// Compares two bench results. speedup = a.opsPerSec / b.opsPerSec, so >1 means a is faster.
export function compareBench(a, b) {
  const speedup = a.opsPerSec / b.opsPerSec;
  let faster = 'tie';
  if (speedup > 1) faster = a.name;
  else if (speedup < 1) faster = b.name;
  return { faster, speedup, meanDelta: a.mean - b.mean };
}
