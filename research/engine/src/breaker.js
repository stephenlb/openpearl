// Circuit breaker: closed -> open after `threshold` consecutive failures,
// open -> half-open after `cooldownMs`, half-open -> closed on a successful
// probe or back to open on a failed one.
export class BreakerOpenError extends Error {
  constructor() {
    super('Circuit breaker is open');
    this.name = 'BreakerOpenError';
  }
}

export function createBreaker({ threshold = 5, cooldownMs = 30000, now = Date.now } = {}) {
  let failures = 0;
  let openedAt = null;
  // Token of the in-flight half-open probe, if any; reset() drops it so a
  // stale probe can't clear a newer probe's claim.
  let probe = null;
  // Bumped whenever the breaker trips or closes, so results of calls that
  // started before the change are ignored.
  let epoch = 0;

  function state() {
    if (openedAt === null) return 'closed';
    return now() - openedAt >= cooldownMs ? 'half-open' : 'open';
  }

  function trip() {
    openedAt = now();
    failures = 0;
    epoch++;
  }

  async function call(fn) {
    const current = state();
    if (current === 'open' || (current === 'half-open' && probe !== null)) {
      throw new BreakerOpenError();
    }
    const isProbe = current === 'half-open';
    const token = isProbe ? Symbol('probe') : null;
    if (isProbe) probe = token;
    const startEpoch = epoch;
    try {
      const result = await fn();
      if (epoch === startEpoch) {
        failures = 0;
        if (openedAt !== null) epoch++;
        openedAt = null;
      }
      return result;
    } catch (err) {
      if (epoch === startEpoch) {
        if (isProbe) trip();
        else if (++failures >= threshold) trip();
      }
      throw err;
    } finally {
      if (isProbe && probe === token) probe = null;
    }
  }

  // Forces the breaker closed (used by self-heal); in-flight calls are ignored.
  function reset() {
    failures = 0;
    openedAt = null;
    probe = null;
    epoch++;
  }

  return { call, state, reset };
}
