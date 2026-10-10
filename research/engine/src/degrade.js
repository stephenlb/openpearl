// Degraded-mode controller: steps down a ladder of levels when the error rate
// over a rolling window crosses a level's `enterAt` threshold, and steps back
// up one level at a time with hysteresis (lower exit threshold plus a hold
// time). The clock is injectable so tests never really sleep.
export const DEFAULT_LEVELS = [
  { name: 'full', enterAt: 0 },
  { name: 'reduced', enterAt: 0.25 },
  { name: 'minimal', enterAt: 0.5 },
];

export function createDegrader({
  levels = DEFAULT_LEVELS,
  windowMs = 10000,
  minSamples = 5,
  recoverRatio = 0.5,
  holdMs = 5000,
  now = Date.now,
  onChange = () => {},
} = {}) {
  if (!Array.isArray(levels) || levels.length < 2) {
    throw new RangeError('levels must have at least two entries');
  }
  for (let i = 1; i < levels.length; i++) {
    if (!(levels[i].enterAt > levels[i - 1].enterAt) || levels[i].enterAt > 1) {
      throw new RangeError('levels must have strictly increasing enterAt up to 1');
    }
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new RangeError('windowMs must be a positive number');
  }
  if (!(recoverRatio > 0 && recoverRatio <= 1)) {
    throw new RangeError('recoverRatio must be in (0, 1]');
  }

  const samples = []; // { t, ok }, in time order
  let index = 0;
  let changedAt = now();

  function errorRate() {
    const cutoff = now() - windowMs;
    while (samples.length && samples[0].t <= cutoff) samples.shift();
    if (samples.length < minSamples) return 0;
    return samples.filter((s) => !s.ok).length / samples.length;
  }

  function move(to) {
    const from = levels[index];
    index = to;
    changedAt = now();
    try {
      onChange(levels[index], from);
    } catch {
      // ignored: a throwing listener must not break the controller
    }
  }

  function evaluate() {
    const rate = errorRate();
    let target = 0;
    for (let i = 0; i < levels.length; i++) if (rate >= levels[i].enterAt) target = i;
    if (target > index) {
      move(target);
    } else if (index > 0) {
      const exitBelow = levels[index].enterAt * recoverRatio;
      if (rate < exitBelow && now() - changedAt >= holdMs) move(index - 1);
    }
  }

  return {
    record(ok) {
      samples.push({ t: now(), ok: Boolean(ok) });
      evaluate();
    },
    // Current level object; re-evaluates so recovery happens as time passes.
    level() {
      evaluate();
      return levels[index];
    },
    errorRate,
  };
}
