// Dependency-free SVG chart helpers. Output is deterministic and fully escaped.
// Limits (MVP): layout is fixed-size. Legend entries are spaced 90px apart, x tick
// labels are drawn for every unique x, bar labels are not truncated, and colours
// repeat after 5 series. Non-array input is treated as empty and entries that are
// null or non-numeric (including numeric strings) are dropped.
const COLORS = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2'];

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const num = (n) => String(Math.round(n * 100) / 100);

// Tick labels keep precision proportional to the axis max so small ranges stay readable.
const tickLabel = (v, max) => {
  const decimals = max >= 1 ? 2 : Math.min(10, 1 - Math.floor(Math.log10(max)));
  return String(Number(v.toFixed(decimals)));
};

function layout(opts) {
  const m = { top: 36, right: 16, bottom: 48, left: 56 };
  const dim = (v, def, min) => {
    const n = Number(v ?? def);
    return Number.isFinite(n) ? Math.max(min, Math.round(n)) : def;
  };
  const width = dim(opts.width, 480, m.left + m.right + 1);
  const height = dim(opts.height, 320, m.top + m.bottom + 1);
  return { width, height, m, pw: width - m.left - m.right, ph: height - m.top - m.bottom };
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

function frame(L, opts, body) {
  const { width, height, m, pw, ph } = L;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`,
  ];
  if (opts.title) {
    out.push(`<title>${escapeXml(opts.title)}</title>`);
    out.push(`<text class="title" x="${num(width / 2)}" y="20" text-anchor="middle">${escapeXml(opts.title)}</text>`);
  }
  out.push(`<line class="axis x-axis" x1="${m.left}" y1="${m.top + ph}" x2="${m.left + pw}" y2="${m.top + ph}" stroke="#333"/>`);
  out.push(`<line class="axis y-axis" x1="${m.left}" y1="${m.top}" x2="${m.left}" y2="${m.top + ph}" stroke="#333"/>`);
  out.push(...body);
  if (opts.xLabel) {
    out.push(`<text class="x-label" x="${num(m.left + pw / 2)}" y="${height - 6}" text-anchor="middle">${escapeXml(opts.xLabel)}</text>`);
  }
  if (opts.yLabel) {
    out.push(`<text class="y-label" x="12" y="${num(m.top + ph / 2)}" text-anchor="middle" transform="rotate(-90 12 ${num(m.top + ph / 2)})">${escapeXml(opts.yLabel)}</text>`);
  }
  out.push('</svg>');
  return out.join('\n');
}

function yTicks(L, max, ticks = 5) {
  const { m, pw, ph } = L;
  const out = [];
  for (let i = 0; i <= ticks; i++) {
    const v = (max * i) / ticks;
    const y = m.top + ph - (ph * i) / ticks;
    out.push(`<line class="grid" x1="${m.left}" y1="${num(y)}" x2="${m.left + pw}" y2="${num(y)}" stroke="#ddd"/>`);
    out.push(`<text class="y-tick" x="${m.left - 6}" y="${num(y + 4)}" text-anchor="end">${escapeXml(tickLabel(v, max))}</text>`);
  }
  return out;
}

/** data: [{label, value}] */
export function barChart(rawData = [], opts = {}) {
  const data = (Array.isArray(rawData) ? rawData : []).filter((d) => Number.isFinite(d?.value));
  const L = layout(opts);
  const { m, pw, ph } = L;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const body = yTicks(L, max);
  const slot = data.length ? pw / data.length : pw;
  data.forEach((d, i) => {
    const h = (Math.max(0, d.value) / max) * ph;
    const x = m.left + i * slot + slot * 0.1;
    body.push(`<rect class="bar" x="${num(x)}" y="${num(m.top + ph - h)}" width="${num(slot * 0.8)}" height="${num(h)}" fill="${COLORS[0]}"/>`);
    body.push(`<text class="x-tick" x="${num(x + slot * 0.4)}" y="${m.top + ph + 16}" text-anchor="middle">${escapeXml(d.label)}</text>`);
  });
  return frame(L, opts, body);
}

/** series: [{name, points: [{x, y}]}] */
export function lineChart(rawSeries = [], opts = {}) {
  const series = (Array.isArray(rawSeries) ? rawSeries : []).filter(Boolean).map((s) => ({
    ...s,
    points: (Array.isArray(s.points) ? s.points : []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)),
  }));
  const L = layout(opts);
  const { m, pw, ph } = L;
  const all = series.flatMap((s) => s.points);
  const xs = all.map((p) => p.x);
  const xMin = xs.length ? Math.min(...xs) : 0;
  const xMax = xs.length ? Math.max(...xs) : 1;
  const xSpan = xMax - xMin || 1;
  const max = niceMax(Math.max(0, ...all.map((p) => p.y)));
  const body = yTicks(L, max);
  const px = (x) => m.left + ((x - xMin) / xSpan) * pw;
  const py = (y) => m.top + ph - (Math.max(0, y) / max) * ph;
  for (const v of [...new Set(xs)].sort((a, b) => a - b)) {
    body.push(`<text class="x-tick" x="${num(px(v))}" y="${m.top + ph + 16}" text-anchor="middle">${escapeXml(num(v))}</text>`);
  }
  series.forEach((s, i) => {
    const color = COLORS[i % COLORS.length];
    const pts = s.points.map((p) => `${num(px(p.x))},${num(py(p.y))}`).join(' ');
    body.push(`<polyline class="line" data-series="${escapeXml(s.name)}" points="${pts}" fill="none" stroke="${color}" stroke-width="2"/>`);
    body.push(`<text class="legend" x="${m.left + 8 + i * 90}" y="${m.top - 6}" fill="${color}">${escapeXml(s.name)}</text>`);
  });
  return frame(L, opts, body);
}
