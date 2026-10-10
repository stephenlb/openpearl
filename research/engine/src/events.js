// Structured event log: timestamped events in a ring buffer, queryable and JSONL-serializable.
export function createEventLog({ now = Date.now, cap = Infinity } = {}) {
  if (cap !== Infinity && (!Number.isInteger(cap) || cap < 1)) throw new RangeError('cap must be a positive integer');
  const events = [];
  let seq = 0;

  function push(ev) {
    events.push(ev);
    if (events.length > cap) events.shift();
  }

  function emit(type, data = {}) {
    if (typeof type !== 'string' || !type) throw new TypeError('type must be a non-empty string');
    const ev = { seq: seq++, t: now(), type, data };
    push(ev);
    return ev;
  }

  // Events matching `type` (if given) with t >= `since` (if given), oldest first.
  function query({ type, since } = {}) {
    return events.filter((e) => (type === undefined || e.type === type) && (since === undefined || e.t >= since));
  }

  function toJSONL() {
    return events.map((e) => JSON.stringify(e)).join('\n');
  }

  // Appends events parsed from JSONL (blank lines skipped); returns the number loaded.
  function fromJSONL(str) {
    if (typeof str !== 'string') throw new TypeError('str must be a string');
    const parsed = [];
    for (const line of str.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      if (!ev || typeof ev.type !== 'string' || !ev.type || !Number.isFinite(ev.t)) throw new TypeError('invalid event line');
      const data = ev.data ?? {};
      if (typeof data !== 'object' || Array.isArray(data)) throw new TypeError('invalid event line');
      parsed.push({ t: ev.t, type: ev.type, data });
    }
    for (const p of parsed) push({ seq: seq++, ...p });
    return parsed.length;
  }

  return { emit, query, toJSONL, fromJSONL, size: () => events.length };
}
