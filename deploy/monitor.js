// Live eval after deploy: watches each newly enabled version for a while and
// decides when to roll it back. Pure logic; the host feeds it outcomes.
//
// A new version is rolled back during its watch window when it
//   - reaches past its manifest (any capability denial),
//   - fails too often (5xx rate above maxErrorRate once minRequests have been seen), or
//   - gets maxNegativeFeedback "this didn't do what I asked" reports from the tenant's users.
export function createMonitor({ windowMs = 10 * 60_000, minRequests = 10, maxErrorRate = 0.2, maxNegativeFeedback = 3, now = () => Date.now() } = {}) {
  const watched = new Map(); // key -> { sha, since, requests, errors, negative, tripped }

  const inWindow = (w) => w && !w.tripped && now() - w.since <= windowMs;
  const trip = (w, reason) => {
    w.tripped = reason;
    return { action: 'rollback', sha: w.sha, reason };
  };

  return {
    // Call when a version starts serving
    track(key, sha) {
      if (watched.get(key)?.sha !== sha) watched.set(key, { sha, since: now(), requests: 0, errors: 0, negative: 0, tripped: null });
    },
    record(key, sha, { status, denied = 0 }) {
      const w = watched.get(key);
      if (!w || w.sha !== sha || !inWindow(w)) return { action: 'none' };
      w.requests++;
      if (status >= 500) w.errors++;
      if (denied) return trip(w, 'capability denied');
      if (w.requests >= minRequests && w.errors / w.requests > maxErrorRate) {
        return trip(w, `error rate ${Math.round((100 * w.errors) / w.requests)}% over ${w.requests} requests`);
      }
      return { action: 'none' };
    },
    feedback(key, sha, ok) {
      const w = watched.get(key);
      if (!w || w.sha !== sha || ok || !inWindow(w)) return { action: 'none' };
      if (++w.negative >= maxNegativeFeedback) return trip(w, `${w.negative} users reported it doesn't do what they asked`);
      return { action: 'none' };
    },
    status(key) {
      const w = watched.get(key);
      return w ? { ...w, watching: inWindow(w) } : null;
    },
  };
}
