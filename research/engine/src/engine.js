// Self-optimizing pipeline facade: composes the runner, breaker, classifier,
// adaptive timeout, limiter, cache, metrics and learner behind engine.run().
// All clocks, timers and sleeps are injectable so tests never really wait.
import { runTask } from './runner.js';
import { createBreaker, BreakerOpenError } from './breaker.js';
import { classifyError } from './classify.js';
import { createTimeoutEstimator } from './adaptive-timeout.js';
import { createLimiter } from './concurrency.js';
import { createCache } from './cache.js';
import { createMetrics } from './metrics.js';
import { createLearner } from './learn.js';
import { withTimeout, TimeoutError } from './timeout.js';

export function createEngine({
  healing = true,
  retries = 3,
  delayMs = 0,
  sleep,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  timeout = {},
  breaker: breakerOpts = {},
  limiter: limiterOpts = {},
  cache: cacheOpts,
} = {}) {
  const metrics = createMetrics();
  const learner = createLearner();
  const estimator = createTimeoutEstimator({ min: 1, max: 30000, ...timeout });
  const breaker = createBreaker({ now, ...breakerOpts });
  const limiter = createLimiter({ now, ...limiterOpts });
  const cache = cacheOpts ? createCache({ now, ...cacheOpts }) : null;

  // With healing off the engine makes a single bare attempt: no retries,
  // breaker or adaptive timeout.
  // `last.ms` receives the duration of the most recent attempt.
  async function attempt(fn, last) {
    const started = now();
    try {
      if (!healing) return await fn();
      const value = await breaker.call(() => withTimeout(fn, estimator.current(), { setTimer, clearTimer }));
      estimator.observe(Math.max(0, now() - started));
      return value;
    } catch (err) {
      // Rejections by an open breaker never ran fn and are not real errors.
      if (err instanceof BreakerOpenError) {
        metrics.inc('breaker.rejected');
      } else {
        // Timed-out calls feed the estimator so the timeout can adapt upward.
        if (healing && err instanceof TimeoutError) estimator.observe(Math.max(0, now() - started));
        metrics.inc(`error.${classifyError(err).class}`);
      }
      throw err;
    } finally {
      last.ms = Math.max(0, now() - started);
    }
  }

  /**
   * Runs `fn` under the engine's protections. `cacheKey` (optional) enables
   * caching of successful values. Returns `{ok, value|error, attempts, cached?}`.
   */
  async function run(name, fn, { cacheKey } = {}) {
    if (typeof name !== 'string' || name === '') throw new TypeError('name must be a non-empty string');
    if (typeof fn !== 'function') throw new TypeError('fn must be a function');
    metrics.inc('runs');
    if (cache && cacheKey !== undefined) {
      const hit = cache.get(cacheKey);
      if (hit !== undefined) {
        metrics.inc('cache.hit');
        return { ok: true, value: hit.value, attempts: 0, cached: true };
      }
    }
    const token = limiter.acquire();
    if (!token) {
      metrics.inc('shed');
      return { ok: false, error: new Error('Concurrency limit reached'), attempts: 0, shed: true };
    }
    const started = now();
    const last = { ms: 0 };
    const result = await runTask(() => attempt(fn, last), {
      retries: healing ? retries : 0,
      delayMs,
      ...(sleep ? { sleep } : {}),
    });
    const elapsed = Math.max(0, now() - started);
    limiter.release(result.ok, last.ms, token);
    metrics.observe('latencyMs', elapsed);
    metrics.inc(result.ok ? 'success' : 'failure');
    learner.record({ strategy: name, success: result.ok, costMs: elapsed });
    if (result.ok && cache && cacheKey !== undefined) cache.set(cacheKey, { value: result.value });
    return result;
  }

  return {
    run,
    metrics: () => metrics.snapshot(),
    stats: (name) => learner.stats(name),
    breakerState: () => breaker.state(),
    timeoutMs: () => estimator.current(),
    concurrencyLimit: () => limiter.limit,
    cacheStats: () => (cache ? cache.stats() : null),
  };
}
