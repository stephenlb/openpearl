// Structured event log: in-memory ring buffer with JSONL (de)serialisation.
export function createEventLog({ now = Date.now, cap = Infinity } = {}) {
  if (cap !== Infinity && !(Number.isInteger(cap) && cap > 0)) {
    throw new RangeError('cap must be a positive integer');
  }
  const events = [];
  const copy = (e) => ({ ...e, data: structuredClone(e.data) });

  function push(event) {
    events.push(event);
    if (events.length > cap) events.shift();
  }

  return {
    emit(type, data = {}) {
      const event = { ts: now(), type, data: structuredClone(data) };
      push(event);
      return copy(event);
    },
    query({ type, since } = {}) {
      return events
        .filter((e) => (type === undefined || e.type === type) && (since === undefined || e.ts >= since))
        .map(copy);
    },
    toJSONL() {
      return events.map((e) => JSON.stringify(e)).join('\n');
    },
    fromJSONL(str) {
      const parsed = [];
      for (const line of String(str).split('\n')) {
        if (line.trim() === '') continue;
        const entry = JSON.parse(line);
        if (entry === null || typeof entry !== 'object' || !Number.isFinite(entry.ts) || typeof entry.type !== 'string') {
          throw new TypeError('invalid event: ts must be a finite number and type a string');
        }
        const { ts, type, data = {} } = entry;
        parsed.push({ ts, type, data });
      }
      parsed.forEach(push);
    },
    size: () => events.length,
  };
}
