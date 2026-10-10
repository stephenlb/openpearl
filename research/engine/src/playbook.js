// Self-heal playbook: maps an error class (see classifyError) to an ordered
// list of remedies and runs them until one resolves the failure.
//
// Remedies are strings or `{ type, ...options }`:
//   retry         re-run `ctx.run()`; success ends the playbook as 'healed'. `times` (default 1).
//   backoff       wait `backoffDelay(n)` via `ctx.sleep`; `n` counts backoffs so far. Options go to backoffDelay.
//   reset-breaker call `ctx.breaker.reset()`.
//   replay-dlq    call `ctx.dlq.replay()`.
//   degrade       call `ctx.degrade(error)`; success ends the playbook as 'degraded'.
// Rules under the key `default` apply to classes without their own rule.
import { classifyError } from './classify.js';
import { backoffDelay } from './backoff.js';

export const REMEDIES = ['retry', 'backoff', 'reset-breaker', 'replay-dlq', 'degrade'];

export const DEFAULT_RULES = {
  transient: ['backoff', 'retry', 'reset-breaker', 'retry', 'degrade'],
  timeout: ['backoff', 'retry', 'degrade'],
  resource: ['backoff', 'retry', 'replay-dlq', 'degrade'],
  permanent: ['degrade'],
  unknown: ['degrade'],
};

function normalize(remedy) {
  const step = typeof remedy === 'string' ? { type: remedy } : remedy;
  if (!step || !REMEDIES.includes(step.type)) {
    throw new TypeError(`Unknown remedy: ${JSON.stringify(remedy)}`);
  }
  return step;
}

export function createPlaybook(rules = DEFAULT_RULES) {
  const table = new Map();
  for (const [cls, remedies] of Object.entries(rules)) {
    if (!Array.isArray(remedies)) throw new TypeError(`Rule for "${cls}" must be an array`);
    table.set(cls, remedies.map(normalize));
  }

  function remediesFor(cls) {
    return (table.get(cls) ?? table.get('default') ?? []).map((s) => ({ ...s }));
  }

  // ctx: { run, sleep, breaker, dlq, degrade, rng, classify }. Missing
  // capabilities make the remedy 'skipped' rather than throwing.
  async function heal(error, ctx = {}) {
    const verdict = (ctx.classify ?? classifyError)(error);
    const actions = [];
    let backoffs = 0;
    const record = (type, result, extra) => {
      actions.push({ type, result, ...extra });
      return result;
    };

    for (const step of remediesFor(verdict.class)) {
      const { type, ...opts } = step;
      if (type === 'retry') {
        if (typeof ctx.run !== 'function') { record(type, 'skipped'); continue; }
        const times = opts.times ?? 1;
        for (let i = 0; i < times; i++) {
          try {
            const value = await ctx.run();
            record(type, 'ok');
            return { class: verdict.class, actions, outcome: 'healed', value };
          } catch (err) {
            record(type, 'failed', { error: err });
          }
        }
      } else if (type === 'backoff') {
        if (typeof ctx.sleep !== 'function') { record(type, 'skipped'); continue; }
        const delayMs = backoffDelay(backoffs++, { ...opts, rng: opts.rng ?? ctx.rng ?? Math.random });
        await ctx.sleep(delayMs);
        record(type, 'ok', { delayMs });
      } else if (type === 'reset-breaker') {
        if (typeof ctx.breaker?.reset !== 'function') { record(type, 'skipped'); continue; }
        ctx.breaker.reset();
        record(type, 'ok');
      } else if (type === 'replay-dlq') {
        if (typeof ctx.dlq?.replay !== 'function') { record(type, 'skipped'); continue; }
        try {
          const replayed = await ctx.dlq.replay();
          record(type, 'ok', { replayed });
        } catch (err) {
          record(type, 'failed', { error: err });
        }
      } else if (type === 'degrade') {
        if (typeof ctx.degrade !== 'function') { record(type, 'skipped'); continue; }
        try {
          const value = await ctx.degrade(error);
          record(type, 'ok');
          return { class: verdict.class, actions, outcome: 'degraded', value };
        } catch (err) {
          record(type, 'failed', { error: err });
        }
      }
    }
    return { class: verdict.class, actions, outcome: 'unhealed' };
  }

  return { heal, remediesFor };
}
