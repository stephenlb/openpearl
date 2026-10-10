// Watchdog: tracks heartbeats per id and reports ids silent for longer than
// `timeoutMs`. The clock is injectable so tests never really sleep.
export function createWatchdog({ timeoutMs, now = Date.now, onStall = () => {} } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive number');
  }
  const entries = new Map(); // id -> { last, stalled }

  return {
    heartbeat(id) {
      entries.set(id, { last: now(), stalled: false });
    },
    // Returns all currently stalled ids; onStall fires once per stall (a new
    // heartbeat re-arms it).
    check() {
      const t = now();
      const stalled = [];
      const fresh = [];
      for (const [id, entry] of entries) {
        if (t - entry.last <= timeoutMs) continue;
        stalled.push(id);
        if (!entry.stalled) {
          entry.stalled = true;
          fresh.push(id);
        }
      }
      // A throwing onStall must not stop other ids from being reported.
      for (const id of fresh) {
        try {
          onStall(id);
        } catch {
          // ignored: check() still returns the stalled ids
        }
      }
      return stalled;
    },
    remove(id) {
      return entries.delete(id);
    },
  };
}
