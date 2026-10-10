// Structured event log: in-memory ring buffer with JSONL (de)serialisation.
export function createEventLog({ now = Date.now, cap = Infinity } = {}) {
  if (cap !== Infinity && !(Number.isInteger(cap) && cap > 0)) {
    throw new RangeError('cap must be a positive integer');
  }
  let events = [];

  function push(event) {
    events.push(event);
    if (events.length > cap) events = events.slice(events.length - cap);
  }

  return {
    emit(type, data = {}) {
      const event = { ts: now(), type, data };
      push(event);
      return event;
    },
    query({ type, since } = {}) {
      return events.filter(
        (e) => (type === undefined || e.type === type) && (since === undefined || e.ts >= since),
      );
    },
    toJSONL() {
      return events.map((e) => JSON.stringify(e)).join('\n');
    },
    fromJSONL(str) {
      for (const line of String(str).split('\n')) {
        if (line.trim() === '') continue;
        const { ts, type, data } = JSON.parse(line);
        push({ ts, type, data });
      }
    },
    size: () => events.length,
  };
}
