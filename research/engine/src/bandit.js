// Multi-armed bandit: epsilon-greedy or Thompson sampling (Beta posteriors).
// Rewards are expected in [0, 1]. The rng is injectable for determinism.
import { seededRng } from './rng.js';

function normal(rng) {
  const u = 1 - rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// Marsaglia-Tsang gamma sampler (scale 1).
function gamma(shape, rng) {
  if (shape < 1) return gamma(shape + 1, rng) * Math.pow(1 - rng(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = 1 - rng();
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

export function sampleBeta(a, b, rng) {
  const x = gamma(a, rng);
  const y = gamma(b, rng);
  return x / (x + y);
}

export function createBandit(arms, { mode = 'epsilon', epsilon = 0.1, rng = seededRng(1) } = {}) {
  if (!Array.isArray(arms) || arms.length === 0) throw new Error('arms must be a non-empty array');
  if (mode !== 'epsilon' && mode !== 'thompson') throw new Error(`unknown mode: ${mode}`);
  if (!(Number.isFinite(epsilon) && epsilon >= 0 && epsilon <= 1)) throw new RangeError('epsilon must be in [0, 1]');
  if (new Set(arms.map(String)).size !== arms.length) throw new Error('arms must be unique');
  const stats = new Map(arms.map((a) => [a, { pulls: 0, total: 0 }]));

  const mean = (s) => (s.pulls ? s.total / s.pulls : 0);

  // choose() does not record a pull; only reward() does, so repeated choose()
  // calls without rewards in epsilon mode keep returning the same unpulled arm.
  function choose() {
    if (mode === 'thompson') {
      let best = arms[0];
      let bestV = -Infinity;
      for (const a of arms) {
        const s = stats.get(a);
        const v = sampleBeta(1 + s.total, 1 + s.pulls - s.total, rng);
        if (v > bestV) {
          bestV = v;
          best = a;
        }
      }
      return best;
    }
    if (rng() < epsilon) return arms[Math.floor(rng() * arms.length)];
    let best = arms[0];
    let bestM = -Infinity;
    for (const a of arms) {
      const s = stats.get(a);
      // Unpulled arms are tried first.
      const m = s.pulls ? mean(s) : Infinity;
      if (m > bestM) {
        bestM = m;
        best = a;
      }
    }
    return best;
  }

  function reward(arm, value) {
    const s = stats.get(arm);
    if (!s) throw new Error(`unknown arm: ${String(arm)}`);
    if (!(value >= 0 && value <= 1)) throw new RangeError('reward must be in [0, 1]');
    s.pulls += 1;
    s.total += value;
  }

  function snapshot() {
    return Object.fromEntries(arms.map((a) => [a, { pulls: stats.get(a).pulls, mean: mean(stats.get(a)) }]));
  }

  return { choose, reward, stats: snapshot };
}
