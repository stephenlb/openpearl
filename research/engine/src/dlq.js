// Dead-letter queue. Holds failed jobs with their errors, bounded to `max`
// entries: pushing onto a full queue evicts the oldest entry. replay(handler)
// calls handler(job, err) for each entry, oldest first; entries whose handler
// resolves are removed, entries whose handler throws/rejects stay queued.
// Returns { replayed, failed, remaining } counts. Entries pushed during a
// replay are not replayed in that pass. Deterministic: no clock or RNG.
export function createDLQ({ max = 100 } = {}) {
  if (!(Number.isInteger(max) && max >= 1)) throw new RangeError('max must be a positive integer');
  let entries = [];
  let evicted = 0;

  return {
    push(job, err) {
      entries.push({ job, err });
      if (entries.length > max) {
        entries.shift();
        evicted += 1;
      }
      return entries.length;
    },
    list() {
      return entries.map((e) => ({ job: e.job, err: e.err }));
    },
    async replay(handler) {
      if (typeof handler !== 'function') throw new TypeError('handler must be a function');
      const batch = entries;
      entries = [];
      const kept = [];
      let replayed = 0;
      for (const e of batch) {
        try {
          await handler(e.job, e.err);
          replayed += 1;
        } catch (err) {
          kept.push({ job: e.job, err });
        }
      }
      // Failed entries are older than anything pushed during replay.
      entries = kept.concat(entries).slice(-max);
      return { replayed, failed: kept.length, remaining: entries.length };
    },
    get size() { return entries.length; },
    get evicted() { return evicted; },
  };
}
