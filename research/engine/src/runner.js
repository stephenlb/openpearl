import { classifyError } from './classify.js';
import { withTimeout } from './timeout.js';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Only errors positively classified as non-retryable (`permanent`) are fatal;
// `unknown` errors are still retried. The error name is ignored: a bare
// `TypeError` (e.g. undici's `fetch failed`) may wrap a transient failure.
function judge(err) {
  const probe = err !== null && typeof err === 'object'
    ? { name: err.name === 'BreakerOpenError' ? err.name : 'Error', message: err.message, code: err.code, cause: err.cause }
    : err;
  const verdict = classifyError(probe);
  return { verdict, fatal: !verdict.retryable && verdict.class !== 'unknown' };
}

/**
 * Run `fn` and retry on thrown errors (or rejections).
 * `retries` is the number of retries after the first attempt.
 * Permanent errors stop immediately unless `retryAll` is true.
 * `timeoutMs` (positive number) bounds each attempt via `withTimeout`; a timed-out
 * attempt rejects with a retryable `TimeoutError`. `setTimer`/`clearTimer` are injectable.
 * Timed-out attempts are abandoned, not cancelled: `fn` gets no `AbortSignal`, so the
 * earlier attempt may still be running when the retry starts. Keep `fn` idempotent.
 * `onGiveUp({attempts, error})` is called once when the task fails for good
 * (retries exhausted or a permanent error); errors it throws are ignored.
 * Returns `{ok: true, value, attempts}` or, on failure,
 * `{ok: false, error, attempts, diagnostics}`. Success cannot be guaranteed (a function that
 * always throws never succeeds), so failures are reported honestly: `diagnostics` is
 * `{reason: 'permanent'|'exhausted', maxAttempts, errors: [{attempt, name, message, class, retryable}]}`.
 */
export async function runTask(fn, { retries = 3, delayMs = 0, sleep = defaultSleep, onAttempt, onGiveUp, retryAll = false, timeoutMs, setTimer, clearTimer } = {}) {
  const maxAttempts = (Number.isFinite(retries) ? Math.max(0, retries) : 3) + 1;
  // A misbehaving observer must not affect the task outcome.
  const notify = (info) => {
    try {
      if (onAttempt) Promise.resolve(onAttempt(info)).catch(() => {});
    } catch {
      // ignored
    }
  };
  const useTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
  const timerOpts = {};
  if (setTimer) timerOpts.setTimer = setTimer;
  if (clearTimer) timerOpts.clearTimer = clearTimer;
  let attempts = 0;
  let error;
  let reason = 'exhausted';
  const errors = [];
  while (attempts < maxAttempts) {
    attempts++;
    let value;
    try {
      const attempt = attempts;
      value = useTimeout ? await withTimeout(() => fn(attempt), timeoutMs, timerOpts) : await fn(attempt);
    } catch (err) {
      error = err;
      const { verdict, fatal } = judge(err);
      const isObj = err !== null && typeof err === 'object';
      errors.push({
        attempt: attempts,
        name: isObj ? (typeof err.name === 'string' ? err.name : 'Error') : typeof err,
        message: isObj ? (err.message == null ? '' : String(err.message)) : String(err),
        class: verdict.class,
        retryable: verdict.retryable,
      });
      notify({ attempt: attempts, ok: false, error: err });
      if (!retryAll && fatal) {
        reason = 'permanent';
        break;
      }
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
  return { ok: false, error, attempts, diagnostics: { reason, maxAttempts, errors } };
}
