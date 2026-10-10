// Rolling-window cost budget: charges older than windowMs stop counting.
export function createBudget({ limit, windowMs, now = Date.now } = {}) {
  if (!Number.isFinite(limit) || limit < 0) throw new RangeError('limit must be a non-negative number');
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new RangeError('windowMs must be a positive number');
  let entries = []; // { t, cost }, in chronological order
  let spent = 0;

  function prune() {
    const cutoff = now() - windowMs;
    let i = 0;
    while (i < entries.length && entries[i].t <= cutoff) spent -= entries[i++].cost;
    if (i) entries = entries.slice(i);
    if (!entries.length) spent = 0;
  }

  function remaining() {
    prune();
    return Math.max(0, limit - spent);
  }

  function canAfford(cost = 1) {
    return cost <= remaining();
  }

  // Returns true and records the charge if affordable; otherwise false and nothing is recorded.
  function charge(cost = 1) {
    if (!Number.isFinite(cost) || cost < 0) throw new RangeError('cost must be a non-negative number');
    if (!canAfford(cost)) return false;
    entries.push({ t: now(), cost });
    spent += cost;
    return true;
  }

  return { charge, remaining, canAfford };
}
