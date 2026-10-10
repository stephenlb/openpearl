// Improvement ledger: records changes with before/after metrics and summarizes them.

export function createLedger({ clock = Date.now, higherIsBetter = true, tolerance = 0 } = {}) {
  const entries = [];
  const sign = higherIsBetter ? 1 : -1;

  return {
    record(change, metricBefore, metricAfter) {
      if (!Number.isFinite(metricBefore) || !Number.isFinite(metricAfter)) {
        throw new TypeError('metricBefore and metricAfter must be finite numbers');
      }
      const entry = { change, metricBefore, metricAfter, ts: clock() };
      entries.push(entry);
      return { ...entry };
    },
    entries() {
      return entries.map((e) => ({ ...e }));
    },
    summary() {
      let net = 0;
      let wins = 0;
      const regressions = [];
      for (const e of entries) {
        const delta = sign * (e.metricAfter - e.metricBefore);
        net += delta;
        if (delta > tolerance) wins++;
        else if (delta < -tolerance) regressions.push({ ...e, delta });
      }
      return {
        count: entries.length,
        netImprovement: net,
        wins,
        winRate: entries.length ? wins / entries.length : 0,
        regressions,
      };
    },
  };
}
