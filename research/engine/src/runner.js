const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` and retry on thrown errors (or rejections).
 * `retries` is the number of retries after the first attempt.
 * Returns `{ok: true, value, attempts}` or `{ok: false, error, attempts}`.
 */
export async function runTask(fn, { retries = 3, delayMs = 0, sleep = defaultSleep, onAttempt } = {}) {
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
      if (attempts < maxAttempts && delayMs > 0) await sleep(delayMs);
      continue;
    }
    notify({ attempt: attempts, ok: true });
    return { ok: true, value, attempts };
  }
  return { ok: false, error, attempts };
}
