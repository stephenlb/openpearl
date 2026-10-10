// TTL + LRU cache with optional per-key adaptive TTL. The clock is injected.
// adaptTtl() lengthens the TTL of keys whose observed hit rate is high.
// Expired entries are only removed when read (or evicted by maxEntries), so callers
// should set maxEntries to bound memory.
const HISTORY_LIMIT = 1000;

export function adaptTtl({ ttlMs, hits = 0, misses = 0, minSamples = 5, threshold = 0.8, factor = 2, maxTtlMs = ttlMs * 8 } = {}) {
  if (!(Number.isFinite(ttlMs) && ttlMs > 0)) throw new RangeError('ttlMs must be a positive finite number');
  if (!(Number.isFinite(factor) && factor >= 1)) throw new RangeError('factor must be a finite number >= 1');
  if (!(threshold > 0 && threshold <= 1)) throw new RangeError('threshold must be in (0, 1]');
  if (!(Number.isFinite(minSamples) && minSamples >= 0)) throw new RangeError('minSamples must be a non-negative finite number');
  if (!(Number.isFinite(maxTtlMs) && maxTtlMs >= ttlMs)) throw new RangeError('maxTtlMs must be a finite number >= ttlMs');
  const total = hits + misses;
  if (total === 0 || total < minSamples || hits / total < threshold) return ttlMs;
  return Math.min(maxTtlMs, ttlMs * factor);
}

export function createCache({ ttlMs, now = Date.now, maxEntries = Infinity, adaptive = false, maxTtlMs, minSamples, threshold, factor } = {}) {
  if (!(Number.isFinite(ttlMs) && ttlMs > 0)) throw new RangeError('ttlMs must be a positive finite number');
  if (!(maxEntries === Infinity || (Number.isInteger(maxEntries) && maxEntries > 0))) throw new RangeError('maxEntries must be a positive integer');
  if (adaptive) adaptTtl({ ttlMs, maxTtlMs, minSamples, threshold, factor }); // validate options eagerly
  // Map iteration order = recency order (oldest first).
  const entries = new Map();
  // Per-key hit/miss history; survives expiry so adaptation can learn.
  const history = new Map();
  const s = { hits: 0, misses: 0, evictions: 0, expirations: 0 };

  const record = (key, hit) => {
    const h = history.get(key) ?? { hits: 0, misses: 0 };
    history.delete(key);
    if (hit) h.hits++; else h.misses++;
    history.set(key, h);
    if (history.size > HISTORY_LIMIT) history.delete(history.keys().next().value);
  };

  return {
    // Returns undefined on a miss, so a cached undefined value is indistinguishable from one.
    get(key) {
      const e = entries.get(key);
      if (e && e.expiresAt > now()) {
        entries.delete(key);
        entries.set(key, e);
        s.hits++;
        record(key, true);
        return e.value;
      }
      if (e) {
        entries.delete(key);
        s.expirations++;
      }
      s.misses++;
      record(key, false);
      return undefined;
    },
    set(key, value) {
      const h = history.get(key) ?? { hits: 0, misses: 0 };
      const ttl = adaptive ? adaptTtl({ ttlMs, hits: h.hits, misses: h.misses, minSamples, threshold, factor, maxTtlMs }) : ttlMs;
      entries.delete(key);
      entries.set(key, { value, expiresAt: now() + ttl });
      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value);
        s.evictions++;
      }
    },
    stats() {
      const total = s.hits + s.misses;
      return { ...s, size: entries.size, hitRate: total === 0 ? 0 : s.hits / total };
    },
  };
}
