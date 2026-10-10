// A/B comparison of two arms. Each arm is an array of per-trial outcomes
// (true/1 = success, false/0 = failure). `lift` is the absolute difference in
// success rate (b - a); `z` is the pooled two-proportion z statistic and `p`
// the two-sided p-value from the normal approximation. Decision: 'adopt' if b
// is significantly better at `alpha`, 'reject' if significantly worse, else
// 'inconclusive' (including empty arms or zero variance).
const ALPHA = 0.05;

// Complementary error function (Numerical Recipes erfcc, |err| < 1.2e-7).
function erfc(x) {
  const t = 1 / (1 + 0.5 * Math.abs(x));
  const r = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196
    + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398
    + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

function tally(arm, name) {
  if (!Array.isArray(arm)) throw new TypeError(`${name} must be an array`);
  let successes = 0;
  for (const v of arm) if (v) successes++;
  return { n: arm.length, successes };
}

export function compareArms(a, b, { alpha = ALPHA } = {}) {
  const A = tally(a, 'a');
  const B = tally(b, 'b');
  const rateA = A.n ? A.successes / A.n : 0;
  const rateB = B.n ? B.successes / B.n : 0;
  const lift = rateB - rateA;
  const n = A.n + B.n;
  const pooled = n ? (A.successes + B.successes) / n : 0;
  const se = A.n && B.n ? Math.sqrt(pooled * (1 - pooled) * (1 / A.n + 1 / B.n)) : 0;
  if (se === 0) {
    return { rateA, rateB, lift, z: 0, p: 1, decision: 'inconclusive' };
  }
  const z = lift / se;
  const p = Math.min(1, erfc(Math.abs(z) / Math.SQRT2));
  const decision = p < alpha ? (lift > 0 ? 'adopt' : 'reject') : 'inconclusive';
  return { rateA, rateB, lift, z, p, decision };
}
