// Postmortem generator: turns a list of incident events into a markdown report.
// Events: { ts, type: 'failure' | 'recovery', job, class?, message? } where ts is
// epoch ms or anything Date accepts. Pure and deterministic (no clock reads).
function toMs(ts) {
  const ms = ts instanceof Date ? ts.getTime() : typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(ms)) throw new TypeError(`invalid event timestamp: ${String(ts)}`);
  return ms;
}

// Collapse whitespace/newlines so values can't break the markdown list structure.
function clean(v) {
  return String(v).replace(/\s+/g, ' ').trim();
}

function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${Math.round(ms / 10) / 100}s`;
}

export function buildPostmortem(events = []) {
  if (!Array.isArray(events)) throw new TypeError('events must be an array');
  const sorted = events
    .map((e, i) => ({ ...e, ms: toMs(e.ts), i }))
    .sort((a, b) => a.ms - b.ms || a.i - b.i);

  const classes = new Map();
  const jobs = new Set();
  const open = new Map(); // job -> ms of first unresolved failure
  const durations = [];
  const timeline = [];

  for (const e of sorted) {
    const job = (e.job == null ? '' : clean(e.job)) || '(unknown)';
    jobs.add(job);
    const stamp = new Date(e.ms).toISOString();
    if (e.type === 'recovery') {
      timeline.push(`- ${stamp} recovery: ${job}`);
      if (open.has(job)) {
        durations.push(e.ms - open.get(job));
        open.delete(job);
      }
    } else if (e.type === 'failure') {
      const cls = (e.class == null ? '' : clean(e.class)) || 'unknown';
      const msg = e.message == null ? '' : clean(e.message);
      classes.set(cls, (classes.get(cls) ?? 0) + 1);
      if (!open.has(job)) open.set(job, e.ms);
      timeline.push(`- ${stamp} failure: ${job} [${cls}]${msg ? ` ${msg}` : ''}`);
    } else {
      throw new TypeError(`unknown event type: ${String(e.type)}`);
    }
  }

  const lines = ['# Postmortem', '', '## Timeline', ''];
  lines.push(...(timeline.length ? timeline : ['- none']));
  lines.push('', '## Root causes', '');
  const rows = [...classes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  lines.push(...(rows.length ? rows.map(([c, n]) => `- ${c}: ${n}`) : ['- none']));
  lines.push('', '## MTTR', '');
  if (durations.length) {
    const mean = durations.reduce((s, d) => s + d, 0) / durations.length;
    lines.push(`- ${formatDuration(mean)} across ${durations.length} resolved incident(s)`);
  } else {
    lines.push('- n/a (no resolved incidents)');
  }
  if (open.size) lines.push(`- unresolved: ${open.size}`);
  lines.push('', '## Affected jobs', '');
  const names = [...jobs].sort();
  lines.push(...(names.length ? names.map((j) => `- ${j}`) : ['- none']));
  return lines.join('\n') + '\n';
}
