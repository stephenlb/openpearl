// End-to-end demo: runs the engine (healing off vs on) under every benchmark
// scenario and prints one table row per scenario. Deterministic and instant.
import { loadScenarios, simulate } from '../src/index.js';

const JOBS = 200;
const SEED = 1;

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const COLS = [
  ['scenario', 20, (r) => r.name],
  ['failRate', 8, (r) => pct(r.failRate)],
  ['baseline', 8, (r) => pct(r.baseline.successRate)],
  ['healing', 8, (r) => pct(r.healing.successRate)],
  ['delta', 8, (r) => pct(r.delta.successRate)],
  ['attempts', 8, (r) => r.healing.meanAttempts.toFixed(2)],
  ['p95ms', 6, (r) => String(r.healing.p95LatencyMs)],
];
const line = (cells) => cells.map((c, i) => String(c).padEnd(COLS[i][1])).join('  ').trimEnd();

const rows = [];
for (const s of loadScenarios()) {
  const r = await simulate({ jobs: JOBS, failRate: s.failRate, seed: SEED });
  rows.push({ name: s.name, ...r });
}

console.log(line(COLS.map((c) => c[0])));
console.log(line(COLS.map((c) => '-'.repeat(c[1]))));
for (const r of rows) console.log(line(COLS.map((c) => c[2](r))));
