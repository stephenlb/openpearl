// Scorecard: collapses benchmark results into 0-100 scores for the three self-* properties.
// Every metric is a fraction in [0, 1] (higher is better); missing or invalid values count as 0.
export const WEIGHTS = {
  healing: { recoveryRate: 0.5, availability: 0.3, repairRate: 0.2 },
  improving: { fixRate: 0.4, regressionCoverage: 0.3, qualityGain: 0.3 },
  optimizing: { latencyGain: 0.4, costSaving: 0.3, throughputGain: 0.3 },
};

export const OVERALL_WEIGHTS = { healing: 0.4, improving: 0.3, optimizing: 0.3 };

const round1 = (n) => Math.round(n * 10) / 10;

function clamp01(v) {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function weighted(weights, values) {
  let sum = 0;
  for (const [k, w] of Object.entries(weights)) sum += w * clamp01(values?.[k]);
  return round1(sum * 100);
}

// results: { healing: {...}, improving: {...}, optimizing: {...} } using the metric names in WEIGHTS.
export function scorecard(results = {}) {
  const scores = {};
  for (const dim of Object.keys(WEIGHTS)) scores[dim] = weighted(WEIGHTS[dim], results?.[dim]);
  let overall = 0;
  for (const [dim, w] of Object.entries(OVERALL_WEIGHTS)) overall += w * scores[dim];
  const card = { ...scores, overall: round1(overall), weights: { ...WEIGHTS, overall: OVERALL_WEIGHTS } };
  Object.defineProperty(card, 'markdown', { value: () => renderMarkdown(card), enumerable: false });
  return card;
}

export function renderMarkdown(card) {
  const rows = ['healing', 'improving', 'optimizing'].map((d) => {
    const w = Object.entries(WEIGHTS[d]).map(([k, v]) => `${k} ${v}`).join(', ');
    return `| self-${d} | ${card[d]} | ${OVERALL_WEIGHTS[d]} | ${w} |`;
  });
  return [
    '| Dimension | Score | Weight | Metric weights |',
    '| --- | ---: | ---: | --- |',
    ...rows,
    `| **overall** | **${card.overall}** | 1 | |`,
    '',
  ].join('\n');
}
