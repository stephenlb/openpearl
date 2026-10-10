// Postmortem generator: turns event-log events into a markdown report.
// Recognised types: 'failure' (data.job, data.class) and 'recovery' (data.job); others appear in the timeline only.
// MTTR = mean time from a job's first unresolved failure to its next recovery.
export function buildPostmortem(events) {
  if (!Array.isArray(events)) throw new TypeError('events must be an array');
  const sorted = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.t - b.e.t || a.i - b.i)
    .map((x) => x.e);

  const classes = new Map();
  const jobs = new Set();
  const open = new Map();
  const repairs = [];
  for (const ev of sorted) {
    const { job, class: cls } = ev.data ?? {};
    if (ev.type === 'failure') {
      const c = cls ?? 'unknown';
      classes.set(c, (classes.get(c) ?? 0) + 1);
      if (job !== undefined) {
        jobs.add(String(job));
        if (!open.has(job)) open.set(job, ev.t);
      }
    } else if (ev.type === 'recovery' && open.has(job)) {
      repairs.push(ev.t - open.get(job));
      open.delete(job);
    }
  }

  const lines = ['# Postmortem', '', '## Timeline', ''];
  if (sorted.length === 0) lines.push('_No events._');
  for (const ev of sorted) {
    const detail = Object.entries(ev.data ?? {}).map(([k, v]) => `${k}=${v}`).join(' ');
    lines.push(`- t=${ev.t} ${ev.type}${detail ? ` ${detail}` : ''}`);
  }

  lines.push('', '## Root causes', '');
  if (classes.size === 0) lines.push('_None._');
  for (const [c, n] of [...classes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) lines.push(`- ${c}: ${n}`);

  const mttr = repairs.length ? repairs.reduce((s, x) => s + x, 0) / repairs.length : null;
  lines.push('', '## MTTR', '', mttr === null ? 'n/a' : `${mttr}ms (${repairs.length} recovered)`);

  lines.push('', '## Affected jobs', '');
  if (jobs.size === 0) lines.push('_None._');
  for (const j of [...jobs].sort()) lines.push(`- ${j}`);

  return lines.join('\n') + '\n';
}
