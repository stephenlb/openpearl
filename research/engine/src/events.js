// Structured event log: timestamped events in a ring buffer, queryable and JSONL-serializable.
export function createEventLog({ now = Date.now, cap = Infinity } = {}) {
  if (cap !== Infinity && (!Number.isInteger(cap) || cap < 1)) throw new RangeError('cap must be a positive integer');
  let events = [];
  let seq = 0;

  function push(ev) {
    events.push(ev);
    if (events.length > cap) events = events.slice(events.length - cap);
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
    let n = 0;
    for (const line of str.split('\n')) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      if (!ev || typeof ev.type !== 'string' || !Number.isFinite(ev.t)) throw new TypeError('invalid event line');
      push({ seq: seq++, t: ev.t, type: ev.type, data: ev.data ?? {} });
      n++;
    }
    return n;
  }

  return { emit, query, toJSONL, fromJSONL, size: () => events.length };
}
