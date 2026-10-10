// Dead-letter queue: bounded FIFO of failed jobs. When full, the oldest entry
// is evicted. `now` is an injectable clock (ms). The job itself is stored by
// reference; list() returns copies of the entry metadata.
export function createDLQ({ max = 100, now = Date.now } = {}) {
  if (!Number.isInteger(max) || max < 1) throw new TypeError('max must be a positive integer');
  let entries = [];

  // Returns the number of entries evicted (0 or 1).
  function push(job, err) {
    let evicted = 0;
    if (entries.length >= max) {
      entries.shift();
      evicted = 1;
    }
    entries.push({
      job,
      error: {
        name: err?.name ?? 'Error',
        message: err?.message ?? String(err),
      },
      at: now(),
    });
    return evicted;
  }

  // Oldest first.
  function list() {
    return entries.map((e) => ({ ...e, error: { ...e.error } }));
  }

  // Calls handler(job) for each queued entry, oldest first. Entries whose
  // handler resolves are removed; those that throw/reject stay queued.
  // Returns { replayed, failed }.
  async function replay(handler) {
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    const batch = entries;
    entries = [];
    const kept = [];
    let replayed = 0;
    let failed = 0;
    for (const entry of batch) {
      try {
        await handler(entry.job);
        replayed++;
      } catch {
        failed++;
        kept.push(entry);
      }
    }
    // Failed entries are older than anything pushed during replay; re-enqueue
    // them first and drop the oldest if the bound is exceeded.
    entries = [...kept, ...entries].slice(-max);
    return { replayed, failed };
  }

  return { push, list, replay };
}
