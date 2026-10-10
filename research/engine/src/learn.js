// Outcome learner: records attempt outcomes per strategy and reports summary
// statistics, including the Wilson score lower bound of the success rate.
const Z95 = 1.959963984540054;

export function wilsonLowerBound(successes, n, z = Z95) {
  if (n === 0) return 0;
  const p = successes / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, (centre - margin) / (1 + z2 / n));
}

export function createLearner() {
  const data = new Map(); // strategy -> { attempts, successes, totalCost, contexts }

  return {
    record({ strategy, context, success, costMs = 0 } = {}) {
      if (typeof strategy !== 'string' || strategy === '') {
        throw new TypeError('strategy must be a non-empty string');
      }
      if (!Number.isFinite(costMs) || costMs < 0) {
        throw new RangeError('costMs must be a non-negative number');
      }
      let entry = data.get(strategy);
      if (!entry) {
        entry = { attempts: 0, successes: 0, totalCost: 0, contexts: [] };
        data.set(strategy, entry);
      }
      entry.attempts += 1;
      if (success) entry.successes += 1;
      entry.totalCost += costMs;
      entry.contexts.push(context);
    },
    stats(strategy) {
      const e = data.get(strategy);
      if (!e) return { attempts: 0, successRate: 0, meanCost: 0, wilsonLower: 0 };
      return {
        attempts: e.attempts,
        successRate: e.successes / e.attempts,
        meanCost: e.totalCost / e.attempts,
        wilsonLower: wilsonLowerBound(e.successes, e.attempts),
      };
    },
  };
}
