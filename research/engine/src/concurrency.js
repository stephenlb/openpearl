// Adaptive concurrency limiter (AIMD). The limit grows additively on success
// (by 1 per `limit` successes, i.e. ~1 per round trip) and shrinks
// multiplicatively on failure or a latency spike (latency > spikeFactor x the
// EWMA baseline), at most once per round trip. acquire() is non-blocking: it
// returns a token, or false at the limit. The clock is injectable; latency
// defaults to now() - the acquire time of the released token (default: oldest).
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
  const inflight = []; // tokens, in acquire order
  let epoch = 0; // bumped on each decrease; a request begun before it cannot decrease again

  const decrease = (token) => {
    if (token.epoch !== epoch) return; // already backed off since this request began
    epoch += 1;
    limit = Math.max(min, Math.floor(limit * backoff));
    credit = 0;
  };

  return {
    // Returns a token (truthy) to pass to release(), or false at the limit.
    acquire() {
      if (inflight.length >= limit) return false;
      const token = { began: now(), epoch };
      inflight.push(token);
      return token;
    },
    // `token` identifies the finished request; if omitted, the oldest in-flight one is used.
    release(ok = true, latencyMs, token) {
      if (inflight.length === 0) throw new Error('release() without matching acquire()');
      const i = token === undefined ? 0 : inflight.indexOf(token);
      if (i < 0) throw new Error('release() with unknown token');
      const [t] = inflight.splice(i, 1);
      const latency = latencyMs ?? now() - t.began;
      if (!(Number.isFinite(latency) && latency >= 0)) throw new RangeError('latency must be a non-negative finite number');
      if (!ok) { decrease(t); return; }
      const spike = baseline !== null && latency > spikeFactor * baseline;
      // Spikes feed the baseline too, so a permanent latency shift is eventually accepted.
      baseline = baseline === null ? latency : baseline + alpha * (latency - baseline);
      if (spike) { decrease(t); return; }
      credit += 1 / limit;
      if (credit >= 1 - 1e-9) {
        credit = 0;
        limit = Math.min(max, limit + 1);
      }
    },
    get limit() { return limit; },
    get inFlight() { return inflight.length; },
  };
}
