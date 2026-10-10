import { classifyError } from './classify.js';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Only errors positively classified as non-retryable (`permanent`) are fatal;
// `unknown` errors are still retried. The error name is ignored: a bare
// `TypeError` (e.g. undici's `fetch failed`) may wrap a transient failure.
function isFatal(err) {
  const probe = err !== null && typeof err === 'object'
    ? { name: err.name === 'BreakerOpenError' ? err.name : 'Error', message: err.message, code: err.code, cause: err.cause }
    : err;
  const { class: kind, retryable } = classifyError(probe);
  return !retryable && kind !== 'unknown';
}

/**
 * Run `fn` and retry on thrown errors (or rejections).
 * `retries` is the number of retries after the first attempt.
 * Permanent errors stop immediately unless `retryAll` is true.
 * `onGiveUp({attempts, error})` is called once when the task fails for good
 * (retries exhausted or a permanent error); errors it throws are ignored.
 * Returns `{ok: true, value, attempts}` or `{ok: false, error, attempts}`.
 */
export async function runTask(fn, { retries = 3, delayMs = 0, sleep = defaultSleep, onAttempt, onGiveUp, retryAll = false } = {}) {
  const maxAttempts = (Number.isFinite(retries) ? Math.max(0, retries) : 3) + 1;
  // A misbehaving observer must not affect the task outcome.
  const notify = (info) => {
    try {
      if (onAttempt) Promise.resolve(onAttempt(info)).catch(() => {});
    } catch {
      // ignored
    }
  };
  let attempts = 0;
  let error;
  while (attempts < maxAttempts) {
    attempts++;
    let value;
    try {
      value = await fn(attempts);
    } catch (err) {
      error = err;
      notify({ attempt: attempts, ok: false, error: err });
      if (!retryAll && isFatal(err)) break;
      if (attempts < maxAttempts && delayMs > 0) await sleep(delayMs);
      continue;
    }
    notify({ attempt: attempts, ok: true });
    return { ok: true, value, attempts };
  }
  try {
    if (onGiveUp) Promise.resolve(onGiveUp({ attempts, error })).catch(() => {});
  } catch {
    // ignored
  }
  return { ok: false, error, attempts };
}
