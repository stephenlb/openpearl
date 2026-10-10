// Exponential backoff with symmetric jitter. `attempt` is zero-based.
export function backoffDelay(
  attempt,
  { baseMs = 100, factor = 2, maxMs = 10000, jitter = 0.2, rng = Math.random } = {},
) {
  const raw = Math.min(maxMs, baseMs * factor ** Math.max(0, attempt));
  const spread = 1 + jitter * (2 * rng() - 1);
  // Floor the cap so a fractional maxMs can't leak a non-integer result.
  return Math.min(Math.floor(maxMs), Math.max(0, Math.round(raw * spread)));
}
