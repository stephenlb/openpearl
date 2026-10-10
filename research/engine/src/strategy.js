// Strategy scoring and selection. The learner is any object with
// `stats(id) -> { successes, failures }` (missing/unknown ids count as no
// observations). Candidates are `{ id, cost }` and are ranked best first by
// Wilson lower bound of the success rate (higher wins), then cost (lower
// wins); remaining ties keep input order.
const Z = 1.96; // 95% confidence

export function wilsonLowerBound(successes, failures, z = Z) {
  const n = successes + failures;
  if (n === 0) return 0;
  const p = successes / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, (centre - margin) / (1 + z2 / n));
}

function count(v) {
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function rankStrategies(learner, candidates) {
  if (!learner || typeof learner.stats !== 'function') {
    throw new TypeError('learner must have a stats(id) function');
  }
  if (!Array.isArray(candidates)) {
    throw new TypeError('candidates must be an array');
  }
  const scored = candidates.map((candidate, order) => {
    const s = learner.stats(candidate.id) ?? {};
    const cost = Number.isFinite(candidate.cost) ? candidate.cost : Infinity;
    return {
      candidate,
      order,
      cost,
      score: wilsonLowerBound(count(s.successes), count(s.failures)),
    };
  });
  scored.sort((a, b) => b.score - a.score || a.cost - b.cost || a.order - b.order);
  return scored.map((x) => x.candidate);
}
