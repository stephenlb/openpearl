// Circuit breaker: closed -> open after `threshold` consecutive failures,
// open -> half-open after `cooldownMs`, half-open -> closed on a successful
// probe or back to open on a failed one.
export function createBreaker({ threshold = 5, cooldownMs = 30000, now = Date.now } = {}) {
  let failures = 0;
  let openedAt = null;
  let probing = false;

  function state() {
    if (openedAt === null) return 'closed';
    return now() - openedAt >= cooldownMs ? 'half-open' : 'open';
  }

  function trip() {
    openedAt = now();
    failures = 0;
  }

  async function call(fn) {
    const current = state();
    if (current === 'open' || (current === 'half-open' && probing)) {
      throw new Error('Circuit breaker is open');
    }
    const isProbe = current === 'half-open';
    if (isProbe) probing = true;
    try {
      const result = await fn();
      failures = 0;
      openedAt = null;
      return result;
    } catch (err) {
      if (isProbe) trip();
      else if (++failures >= threshold) trip();
      throw err;
    } finally {
      if (isProbe) probing = false;
    }
  }

  return { call, state };
}
