// Timeout wrapper: rejects with TimeoutError if `promiseFn()` has not settled
// within `ms`. Timer functions are injectable so tests never really sleep.
export class TimeoutError extends Error {
  constructor(ms) {
    super(`Timed out after ${ms}ms`);
    this.name = 'TimeoutError';
    this.ms = ms;
  }
}

export function withTimeout(promiseFn, ms, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  return new Promise((resolve, reject) => {
    const handle = setTimer(() => reject(new TimeoutError(ms)), ms);
    let promise;
    try {
      promise = Promise.resolve(promiseFn());
    } catch (err) {
      clearTimer(handle);
      reject(err);
      return;
    }
    promise.then(
      (value) => { clearTimer(handle); resolve(value); },
      (err) => { clearTimer(handle); reject(err); },
    );
  });
}
