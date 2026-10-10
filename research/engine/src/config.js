// Config loader: merges defaults, validates types/ranges, reports ALL problems at once.
export const DEFAULTS = Object.freeze({
  retries: 3,
  timeoutMs: 30000,
  concurrency: 4,
  cacheTtlMs: 60000,
});

// [min, max] — all values must be integers
const RULES = {
  retries: [0, 100],
  timeoutMs: [1, Number.MAX_SAFE_INTEGER],
  concurrency: [1, 1024],
  cacheTtlMs: [0, Number.MAX_SAFE_INTEGER],
};

export function loadConfig(obj = {}) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Invalid config: expected a plain object');
  }
  const config = { ...DEFAULTS };
  const errors = [];
  for (const [key, value] of Object.entries(obj)) {
    if (!(key in RULES)) errors.push(`${key}: unknown option`);
    else if (value !== undefined) config[key] = value;
  }
  for (const [key, [min, max]] of Object.entries(RULES)) {
    const v = config[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`${key}: must be a finite number (got ${String(v)})`);
    } else if (!Number.isInteger(v)) {
      errors.push(`${key}: must be an integer (got ${v})`);
    } else if (v < min || v > max) {
      errors.push(`${key}: must be between ${min} and ${max} (got ${v})`);
    }
  }
  if (errors.length) throw new Error(`Invalid config: ${errors.join('; ')}`);
  return config;
}
