// Simulation runner: runs N jobs under injected chaos with and without healing
// and compares the outcomes. Uses a virtual clock, so nothing really sleeps
// and results are fully determined by the seed.
import { createEngine } from './engine.js';
import { createChaos } from './chaos.js';
import { seededRng } from './rng.js';

const LATENCY_MS = 10;

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

async function runArm({ jobs, failRate, seed, healing, engineConfig }) {
  let t = 0;
  const sleep = async (ms) => { t += ms; };
  const engine = createEngine({
    delayMs: 5,
    breaker: { threshold: 1000 },
    ...engineConfig,
    healing,
    now: () => t,
    sleep,
  });
  // Same seed per arm so both face the same fault sequence at the first attempts.
  const chaos = createChaos({ rng: seededRng(seed), failRate, latencyMs: LATENCY_MS, sleep });
  const task = chaos.wrap(async () => 'ok');

  const latencies = [];
  let successes = 0;
  let attempts = 0;
  let incidentStart = null;
  let recoveryTotal = 0;
  let incidents = 0;
  for (let i = 0; i < jobs; i++) {
    const started = t;
    const r = await engine.run('job', task);
    latencies.push(t - started);
    attempts += r.attempts;
    if (r.ok) {
      successes++;
      // MTTR: virtual time from the first failed job of an outage to the next success.
      if (incidentStart !== null) {
        recoveryTotal += t - incidentStart;
        incidents++;
        incidentStart = null;
      }
    } else if (incidentStart === null) {
      incidentStart = started;
    }
  }
  latencies.sort((a, b) => a - b);
  return {
    successRate: jobs > 0 ? successes / jobs : 0,
    meanAttempts: jobs > 0 ? attempts / jobs : 0,
    p95LatencyMs: percentile(latencies, 0.95),
    mttrMs: incidents > 0 ? recoveryTotal / incidents : 0,
  };
}

/**
 * Runs `jobs` jobs with chaos at `failRate` twice (healing off / on) and
 * returns `{jobs, failRate, seed, baseline, healing, delta}`.
 */
export async function simulate({ jobs = 100, failRate = 0.3, seed = 1, engineConfig = {} } = {}) {
  if (!Number.isInteger(jobs) || jobs < 0) throw new RangeError('jobs must be a non-negative integer');
  if (!(failRate >= 0 && failRate <= 1)) throw new RangeError('failRate must be between 0 and 1');
  const common = { jobs, failRate, seed, engineConfig };
  const baseline = await runArm({ ...common, healing: false });
  const healing = await runArm({ ...common, healing: true });
  return {
    jobs,
    failRate,
    seed,
    baseline,
    healing,
    delta: {
      successRate: healing.successRate - baseline.successRate,
      meanAttempts: healing.meanAttempts - baseline.meanAttempts,
      p95LatencyMs: healing.p95LatencyMs - baseline.p95LatencyMs,
      mttrMs: healing.mttrMs - baseline.mttrMs,
    },
  };
}
