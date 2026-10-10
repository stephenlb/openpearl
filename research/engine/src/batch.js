// Batching queue: coalesces items and hands them to `flush` as one array when
// `maxSize` items are pending or `maxWaitMs` has passed since the first
// pending item. `setTimer(fn, ms)` must return a cancel function; it is
// injectable so tests never really sleep.
const defaultSetTimer = (fn, ms) => {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
};

export function createBatcher({ maxSize, maxWaitMs, flush, setTimer = defaultSetTimer } = {}) {
  if (!Number.isInteger(maxSize) || maxSize <= 0) {
    throw new RangeError('maxSize must be a positive integer');
  }
  if (!Number.isFinite(maxWaitMs) || maxWaitMs < 0) {
    throw new RangeError('maxWaitMs must be a non-negative number');
  }
  if (typeof flush !== 'function') throw new TypeError('flush must be a function');

  let items = [];
  let cancel = null;

  function flushNow() {
    if (items.length === 0) return undefined;
    if (cancel) {
      cancel();
      cancel = null;
    }
    const batch = items;
    items = [];
    return flush(batch);
  }

  return {
    // Returns flush's result when this item triggered a size flush.
    add(item) {
      items.push(item);
      if (items.length >= maxSize) return flushNow();
      if (!cancel) {
        cancel = setTimer(() => {
          cancel = null;
          // Timer-driven flushes have no caller to report errors to.
          try {
            Promise.resolve(flushNow()).catch(() => {});
          } catch {
            // ignored: the batch was already removed from the queue
          }
        }, maxWaitMs);
      }
      return undefined;
    },
    flush: flushNow,
    get size() {
      return items.length;
    },
  };
}
