// Coordinate hill-climbing with random restarts.
// params: { name: { min, max, value?, step? } }. evaluate(values) -> number (lower is better
// unless maximize is set). steps is the evaluation budget. rng yields floats in [0, 1).
export function tune({ params, evaluate, steps = 100, rng = Math.random, maximize = false, minStep = 1e-3 } = {}) {
  const names = Object.keys(params ?? {});
  if (names.length === 0) throw new RangeError('params must not be empty');
  if (typeof evaluate !== 'function') throw new TypeError('evaluate must be a function');
  for (const n of names) {
    const { min, max, step } = params[n];
    if (!(Number.isFinite(min) && Number.isFinite(max) && min <= max)) throw new RangeError(`invalid bounds for ${n}`);
    if (step !== undefined && !(Number.isFinite(step) && step > 0)) throw new RangeError(`invalid step for ${n}`);
  }
  if (!(Number.isFinite(steps) && steps >= 1)) throw new RangeError('steps must be a finite number >= 1');
  if (!(Number.isFinite(minStep) && minStep > 0)) throw new RangeError('minStep must be a positive number');

  const clamp = (n, v) => Math.min(params[n].max, Math.max(params[n].min, v));
  const sign = maximize ? -1 : 1;
  const trajectory = [];
  let best = null;
  let used = 0;

  const score = (values) => {
    const s = evaluate({ ...values });
    if (typeof s !== 'number' || Number.isNaN(s)) throw new TypeError('evaluate must return a number (not NaN)');
    used++;
    trajectory.push({ step: used, params: { ...values }, score: s });
    if (best === null || sign * s < sign * best.score) best = { params: { ...values }, score: s };
    return s;
  };

  const initial = () => {
    const v = {};
    for (const n of names) v[n] = clamp(n, params[n].value ?? (params[n].min + params[n].max) / 2);
    return v;
  };
  const randomPoint = () => {
    const v = {};
    for (const n of names) v[n] = params[n].min + rng() * (params[n].max - params[n].min);
    return v;
  };
  const initialStep = (n) => params[n].step ?? (params[n].max - params[n].min) / 4;

  let restarts = 0;
  let current = initial();
  while (used < steps) {
    let cur = score(current);
    const stepSize = Object.fromEntries(names.map((n) => [n, initialStep(n)]));
    let converged = false;
    while (used < steps && !converged) {
      let improved = false;
      for (const n of names) {
        for (const dir of [1, -1]) {
          if (used >= steps) break;
          const cand = { ...current, [n]: clamp(n, current[n] + dir * stepSize[n]) };
          if (cand[n] === current[n]) continue;
          const s = score(cand);
          if (sign * s < sign * cur) {
            current = cand;
            cur = s;
            improved = true;
            break;
          }
        }
      }
      if (!improved) {
        let alive = false;
        for (const n of names) {
          stepSize[n] /= 2;
          if (stepSize[n] >= minStep) alive = true;
        }
        converged = !alive;
      }
    }
    if (used < steps) {
      restarts++;
      current = randomPoint();
    }
  }
  return { best: best.params, score: best.score, trajectory, evaluations: used, restarts };
}
