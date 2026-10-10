// Adaptive timeout estimator: percentile of a rolling window of observed
// durations, scaled by a multiplier and clamped to [min, max].
// With no observations yet, current() returns max (the conservative choice).
export function createTimeoutEstimator({ min, max, percentile = 0.95, multiplier = 1.5, window = 100 } = {}) {
  if (!(Number.isFinite(min) && min >= 0)) throw new RangeError('min must be a non-negative finite number');
  if (!(Number.isFinite(max) && max >= min)) throw new RangeError('max must be a finite number >= min');
  if (!(Number.isFinite(percentile) && percentile > 0 && percentile <= 1)) throw new RangeError('percentile must be in (0, 1]');
  if (!(Number.isFinite(multiplier) && multiplier > 0)) throw new RangeError('multiplier must be positive');
  if (!(Number.isInteger(window) && window > 0)) throw new RangeError('window must be a positive integer');
  const samples = [];

  return {
    observe(ms) {
      if (!(Number.isFinite(ms) && ms >= 0)) throw new RangeError('ms must be a non-negative finite number');
      samples.push(ms);
      if (samples.length > window) samples.shift();
    },
    current() {
      if (samples.length === 0) return max;
      const sorted = [...samples].sort((a, b) => a - b);
      // Nearest-rank percentile.
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentile * sorted.length) - 1));
      return Math.min(max, Math.max(min, sorted[idx] * multiplier));
    },
  };
}
