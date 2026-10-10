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

function eventMessage(event) {
  const err = event?.error;
  return event?.message ?? err?.message ?? (typeof err === 'string' ? err : undefined);
}

export function failureSignature(event) {
  if (typeof event?.signature === 'string') {
    const explicit = event.signature.replace(/\s+/g, ' ').trim();
    if (explicit !== '') return explicit;
  }
  const kind = event?.code ?? event?.name ?? 'Error';
  const msg = normalize(eventMessage(event));
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
    if (ev?.task != null) g.tasks.add(String(ev.task));
  }
  return [...groups.entries()]
    .filter(([, g]) => g.events.length >= minCount)
    .sort(([a, ga], [b, gb]) => gb.events.length - ga.events.length || (a < b ? -1 : a > b ? 1 : 0))
    .map(([sig, g]) => {
      const chars = Array.from(sig);
      const label = chars.length > MAX_TITLE ? `${chars.slice(0, MAX_TITLE - 1).join('')}…` : sig;
      const lines = [
        `Recurring failure observed ${g.events.length} times.`,
        '',
        `Signature: \`${sig.replace(/`/g, "'")}\``,
      ];
      if (g.tasks.size) lines.push(`Affected tasks: ${[...g.tasks].sort().join(', ')}`);
      const msgs = g.events
        .map(eventMessage)
        .filter((m) => m !== undefined && m !== null && m !== '')
        .map(String)
        .sort();
      if (msgs.length) {
        const msg = msgs[0];
        const longest = Math.max(0, ...(msg.match(/`+/g) ?? []).map((r) => r.length));
        const fence = '`'.repeat(Math.max(3, longest + 1));
        lines.push('', 'Example message:', fence, msg, fence);
      }
      return {
        title: `[failure] ${label}`,
        body: lines.join('\n'),
        labels: ['bug', 'self-heal'],
      };
    });
}
