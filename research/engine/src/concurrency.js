// Adaptive concurrency limiter (AIMD). The limit grows additively on success
// (by 1 per `limit` successes, i.e. ~1 per round trip) and shrinks
// multiplicatively on failure or a latency spike (latency > spikeFactor x the
// EWMA baseline). acquire() is non-blocking: it returns false at the limit.
// The clock is injectable; latency defaults to now() - the oldest acquire time.
export function createLimiter({ min = 1, max = 100, start = min, backoff = 0.5, spikeFactor = 3, alpha = 0.2, now = Date.now } = {}) {
  if (!(Number.isInteger(min) && min >= 1)) throw new RangeError('min must be a positive integer');
  if (!(Number.isInteger(max) && max >= min)) throw new RangeError('max must be an integer >= min');
  if (!(Number.isInteger(start) && start >= min && start <= max)) throw new RangeError('start must be an integer in [min, max]');
  if (!(Number.isFinite(backoff) && backoff > 0 && backoff < 1)) throw new RangeError('backoff must be in (0, 1)');
  if (!(Number.isFinite(spikeFactor) && spikeFactor > 1)) throw new RangeError('spikeFactor must be > 1');
  if (!(Number.isFinite(alpha) && alpha > 0 && alpha <= 1)) throw new RangeError('alpha must be in (0, 1]');
  let limit = start;
  let credit = 0; // fractional growth accumulated from successes
  let baseline = null;
  const starts = [];

  const decrease = () => {
    limit = Math.max(min, Math.floor(limit * backoff));
    credit = 0;
  };

  return {
    acquire() {
      if (starts.length >= limit) return false;
      starts.push(now());
      return true;
    },
    release(ok = true, latencyMs) {
      if (starts.length === 0) throw new Error('release() without matching acquire()');
      const began = starts.shift();
      const latency = latencyMs ?? now() - began;
      if (!ok) { decrease(); return; }
      if (baseline !== null && latency > spikeFactor * baseline) { decrease(); return; }
      baseline = baseline === null ? latency : baseline + alpha * (latency - baseline);
      credit += 1 / limit;
      if (credit >= 1 - 1e-9) {
        credit = 0;
        limit = Math.min(max, limit + 1);
      }
    },
    get limit() { return limit; },
    get inFlight() { return starts.length; },
  };
}
