// Product-level evaluation of pearl-engine: self-healing sweep, self-improving (bandit, A/B), self-optimizing (tuner, timeout, AIMD, cache).
import { writeFileSync } from 'node:fs';
import { simulate } from '../engine/src/sim.js';
import { seededRng } from '../engine/src/rng.js';
import { createBandit } from '../engine/src/bandit.js';
import { compareArms } from '../engine/src/ab.js';
import { tune } from '../engine/src/tuner.js';
import { createTimeoutEstimator } from '../engine/src/adaptive-timeout.js';
import { createLimiter } from '../engine/src/concurrency.js';
import { createCache } from '../engine/src/cache.js';
import { scorecard } from '../engine/src/scorecard.js';

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const out = {};

// 1. self-healing sweep
out.healing = [];
for (let p = 0; p <= 0.9001; p += 0.05) {
  const rs = [];
  for (let seed = 1; seed <= 10; seed++) rs.push(await simulate({ jobs: 400, failRate: p, seed }));
  const f = (arm, k) => rs.map((r) => r[arm][k]);
  out.healing.push({ failRate: +p.toFixed(2), runs: rs.length, jobs: 400,
    baselineSuccess: mean(f('baseline', 'successRate')), baselineSd: sd(f('baseline', 'successRate')),
    healingSuccess: mean(f('healing', 'successRate')), healingSd: sd(f('healing', 'successRate')),
    baselineAttempts: mean(f('baseline', 'meanAttempts')), healingAttempts: mean(f('healing', 'meanAttempts')),
    baselineP95: mean(f('baseline', 'p95LatencyMs')), healingP95: mean(f('healing', 'p95LatencyMs')),
    baselineMttr: mean(f('baseline', 'mttrMs')), healingMttr: mean(f('healing', 'mttrMs')) });
}

// 2. self-improving: bandit regret and A/B power
const probs = { a: 0.3, b: 0.5, c: 0.7 }, best = 0.7, PULLS = 1000, SEEDS = 30;
const arms = Object.keys(probs);
function banditRun(mode, seed) {
  const rng = seededRng(seed), env = seededRng(seed + 1000);
  const b = createBandit(arms, { mode, epsilon: 0.1, rng });
  let regret = 0, best_pulls = 0; const curve = [];
  for (let t = 1; t <= PULLS; t++) {
    const arm = b.choose(); const r = env() < probs[arm] ? 1 : 0; b.reward(arm, r);
    regret += best - probs[arm]; if (arm === 'c') best_pulls++;
    if (t % 25 === 0) curve.push(regret);
  }
  return { regret, bestShare: best_pulls / PULLS, curve };
}
function randomRun(seed) {
  const rng = seededRng(seed + 7), curve = []; let regret = 0;
  for (let t = 1; t <= PULLS; t++) { regret += best - probs[arms[Math.floor(rng() * 3)]]; if (t % 25 === 0) curve.push(regret); }
  return { regret, bestShare: 1 / 3, curve };
}
const modes = { random: randomRun, epsilon: (s) => banditRun('epsilon', s), thompson: (s) => banditRun('thompson', s) };
out.bandit = { pulls: PULLS, seeds: SEEDS, probs, x: Array.from({ length: PULLS / 25 }, (_, i) => (i + 1) * 25) };
for (const [m, fn] of Object.entries(modes)) {
  const rs = Array.from({ length: SEEDS }, (_, i) => fn(i + 1));
  out.bandit[m] = { meanRegret: mean(rs.map((r) => r.regret)), sdRegret: sd(rs.map((r) => r.regret)), bestShare: mean(rs.map((r) => r.bestShare)),
    curve: rs[0].curve.map((_, i) => mean(rs.map((r) => r.curve[i]))) };
}
out.ab = { trueA: 0.6, trueB: 0.7, trials: 300, power: [], falseAdopt: [] };
for (const n of [25, 50, 100, 200, 400, 800]) {
  let adopt = 0, falseAdopt = 0; const rng = seededRng(n);
  for (let t = 0; t < 300; t++) {
    const draw = (p) => Array.from({ length: n }, () => rng() < p);
    if (compareArms(draw(0.6), draw(0.7)).decision === 'adopt') adopt++;
    if (compareArms(draw(0.6), draw(0.6)).decision === 'adopt') falseAdopt++;
  }
  out.ab.power.push({ n, adoptRate: adopt / 300 }); out.ab.falseAdopt.push({ n, rate: falseAdopt / 300 });
}

// 3. self-optimizing
const target = { x: 3.2, y: -1.4, z: 7.5 };
const params = { x: { min: -10, max: 10 }, y: { min: -10, max: 10 }, z: { min: 0, max: 20 } };
const noisyObj = (rng) => (v) => Math.hypot(v.x - target.x, v.y - target.y, v.z - target.z) + (rng() - 0.5) * 0.2;
out.tuner = [];
for (const steps of [5, 10, 20, 40, 80, 160]) {
  const te = [], re = [];
  for (let seed = 1; seed <= 30; seed++) {
    const r = tune({ params, evaluate: noisyObj(seededRng(seed + 100)), steps, rng: seededRng(seed) });
    te.push(Math.hypot(r.best.x - target.x, r.best.y - target.y, r.best.z - target.z));
    const rr = seededRng(seed + 500); let bestE = Infinity;
    for (let i = 0; i < steps; i++) bestE = Math.min(bestE, Math.hypot(-10 + 20 * rr() - target.x, -10 + 20 * rr() - target.y, 20 * rr() - target.z));
    re.push(bestE);
  }
  out.tuner.push({ steps, tunerErr: mean(te), randomErr: mean(re) });
}
// adaptive timeout under a latency regime shift (100ms -> 400ms at t=500)
{
  const rng = seededRng(42), est = createTimeoutEstimator({ min: 50, max: 5000 }); const fixed = 250; let fixedTO = 0, adaptTO = 0, adaptSum = 0; const series = [];
  for (let t = 0; t < 1000; t++) {
    const base = t < 500 ? 100 : 400, lat = base * (0.6 + rng() * 0.8) * (rng() < 0.03 ? 3 : 1);
    const cur = est.current(); if (lat > fixed) fixedTO++; if (lat > cur) adaptTO++; adaptSum += cur; est.observe(lat);
    if (t % 10 === 0) series.push({ t, latency: lat, adaptive: cur, fixed });
  }
  out.timeout = { requests: 1000, fixedMs: fixed, fixedTimeouts: fixedTO, adaptiveTimeouts: adaptTO, adaptiveMeanMs: adaptSum / 1000, series };
}
// AIMD limiter against server whose capacity drops 24 -> 8 at t=300
{
  let t = 0; const lim = createLimiter({ min: 1, max: 64, start: 4, now: () => t }); const traj = []; let rejected = 0, served = 0;
  for (let step = 0; step < 600; step++) {
    t += 10; const cap = step < 300 ? 24 : 8; const toks = [];
    for (;;) { const k = lim.acquire(); if (!k) break; toks.push(k); }
    const over = toks.length > cap;
    toks.forEach((k, i) => { const ok = i < cap; ok ? served++ : rejected++; t += 0; lim.release(ok, ok ? 20 : 200, k); });
    traj.push({ step, limit: lim.limit, capacity: cap, overload: over });
  }
  out.limiter = { steps: 600, served, rejected, rejectRate: rejected / (served + rejected), traj };
}
// cache: fixed vs adaptive TTL, zipf-ish key access
{
  const run = (adaptive) => { let t = 0; const c = createCache({ ttlMs: 100, now: () => t, maxEntries: 200, adaptive, minSamples: 5, threshold: 0.6, factor: 2, maxTtlMs: 800 }); const rng = seededRng(9); let hits = 0, n = 5000;
    for (let i = 0; i < n; i++) { t += 7; const key = 'k' + Math.floor(Math.pow(rng(), 3) * 300); if (c.get(key) !== undefined) hits++; else c.set(key, i); } return hits / n; };
  out.cache = { requests: 5000, fixedHitRate: run(false), adaptiveHitRate: run(true) };
}

// 4. scorecard from measured values
const mid = out.healing.find((r) => r.failRate === 0.3), hi = out.healing.find((r) => r.failRate === 0.6);
const tl = out.tuner[out.tuner.length - 1];
out.scorecard = scorecard({
  healing: { recoveryRate: (mid.healingSuccess - mid.baselineSuccess) / (1 - mid.baselineSuccess), availability: hi.healingSuccess, repairRate: 1 },
  improving: { fixRate: out.bandit.thompson.bestShare, regressionCoverage: out.ab.power[out.ab.power.length - 1].adoptRate, qualityGain: 1 - out.bandit.thompson.meanRegret / out.bandit.random.meanRegret },
  optimizing: { latencyGain: 1 - out.timeout.adaptiveTimeouts / out.timeout.fixedTimeouts, costSaving: 1 - tl.tunerErr / tl.randomErr, throughputGain: (out.cache.adaptiveHitRate - out.cache.fixedHitRate) / (1 - out.cache.fixedHitRate) },
});
out.scorecard = { ...out.scorecard };
writeFileSync(new URL('../data/engine-eval.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ scorecard: out.scorecard, timeout: { f: out.timeout.fixedTimeouts, a: out.timeout.adaptiveTimeouts }, cache: out.cache, bandit: Object.fromEntries(Object.entries(out.bandit).filter(([k, v]) => v.meanRegret).map(([k, v]) => [k, [v.meanRegret, v.bestShare]])), limiter: [out.limiter.rejectRate], tuner: out.tuner }, null, 1));
