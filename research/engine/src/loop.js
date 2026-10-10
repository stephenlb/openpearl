// Feedback loop orchestrator: feeds events through learner, issue drafter and
// ledger. Events may carry any of:
//   - `strategy` + boolean `success` (+ `costMs`): recorded in the learner
//   - failure (`success === false` or an `error`): drafted into issues
//   - `change` + `metricBefore` + `metricAfter`: recorded in the ledger
import { draftIssues } from './issuedraft.js';

export function runImprovementCycle({ events, learner, ledger, minCount } = {}) {
  if (!Array.isArray(events)) throw new TypeError('events must be an array');
  if (!learner || typeof learner.record !== 'function' || typeof learner.stats !== 'function') {
    throw new TypeError('learner must have record(...) and stats(...) functions');
  }
  if (!ledger || typeof ledger.record !== 'function' || typeof ledger.summary !== 'function') {
    throw new TypeError('ledger must have record(...) and summary() functions');
  }

  const strategies = [];
  const failures = [];
  for (const ev of events) {
    if (typeof ev?.strategy === 'string' && typeof ev.success === 'boolean') {
      if (!strategies.includes(ev.strategy)) strategies.push(ev.strategy);
      learner.record({ strategy: ev.strategy, success: ev.success, costMs: ev.costMs });
    }
    if (ev?.change !== undefined && ev.metricBefore !== undefined && ev.metricAfter !== undefined) {
      ledger.record(ev.change, ev.metricBefore, ev.metricAfter);
    }
    if (ev?.success === false || ev?.error !== undefined) failures.push(ev);
  }

  const drafts = draftIssues(failures, minCount === undefined ? undefined : { minCount });
  const ranked = strategies
    .map((strategy, order) => ({ strategy, order, ...learner.stats(strategy) }))
    .sort((a, b) => b.wilsonLower - a.wilsonLower || a.meanCost - b.meanCost || a.order - b.order)
    .map(({ order, ...rest }) => rest);

  return { drafts, ranked, summary: ledger.summary() };
}
