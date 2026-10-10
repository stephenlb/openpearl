// Issue drafter: groups recurring failure events by signature and returns
// drafts shaped for `gh issue create` ({ title, body, labels }).
const MAX_TITLE = 80;

function normalize(text) {
  return String(text ?? '')
    .replace(/0x[0-9a-f]+/gi, '<hex>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function failureSignature(event) {
  if (typeof event?.signature === 'string' && event.signature !== '') return event.signature;
  const kind = event?.code ?? event?.name ?? 'Error';
  const msg = normalize(event?.message ?? event?.error?.message ?? event?.error);
  return msg ? `${kind}: ${msg}` : String(kind);
}

export function draftIssues(events, { minCount = 3 } = {}) {
  if (!Array.isArray(events)) throw new TypeError('events must be an array');
  if (!Number.isInteger(minCount) || minCount < 1) {
    throw new RangeError('minCount must be a positive integer');
  }
  const groups = new Map();
  for (const ev of events) {
    const sig = failureSignature(ev);
    let g = groups.get(sig);
    if (!g) groups.set(sig, (g = { events: [], tasks: new Set() }));
    g.events.push(ev);
    if (ev?.task !== undefined) g.tasks.add(String(ev.task));
  }
  return [...groups.entries()]
    .filter(([, g]) => g.events.length >= minCount)
    .sort(([a, ga], [b, gb]) => gb.events.length - ga.events.length || (a < b ? -1 : a > b ? 1 : 0))
    .map(([sig, g]) => {
      const label = sig.length > MAX_TITLE ? `${sig.slice(0, MAX_TITLE - 1)}…` : sig;
      const lines = [
        `Recurring failure observed ${g.events.length} times.`,
        '',
        `Signature: \`${sig}\``,
      ];
      if (g.tasks.size) lines.push(`Affected tasks: ${[...g.tasks].sort().join(', ')}`);
      const sample = g.events[0];
      const msg = sample?.message ?? sample?.error?.message;
      if (msg) lines.push('', 'Example message:', '```', String(msg), '```');
      return {
        title: `[failure] ${label}`,
        body: lines.join('\n'),
        labels: ['bug', 'self-heal'],
      };
    });
}
