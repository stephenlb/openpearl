// Corrupt state repair helpers. Pure and deterministic.

// Drops lines of a JSONL text that are not valid JSON. Blank lines are skipped
// silently. Returns the cleaned text (valid lines, "\n"-terminated) and the
// dropped lines as { line (1-based), reason }.
export function repairJSONL(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const kept = [];
  const dropped = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === '') return;
    try {
      JSON.parse(raw);
      kept.push(raw.trim());
    } catch (err) {
      dropped.push({ line: i + 1, reason: err.message });
    }
  });
  return { repaired: kept.length ? `${kept.join('\n')}\n` : '', dropped };
}

// Returns a copy of `obj` where fields missing (undefined or null) are filled
// from `schema`, a plain object mapping field name -> default value. Defaults
// are cloned; extra fields in `obj` are kept. A non-object `obj` yields a
// fresh object made entirely of defaults.
export function repairCheckpoint(obj, schema) {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new TypeError('schema must be an object');
  }
  const isObj = obj !== null && typeof obj === 'object' && !Array.isArray(obj);
  const out = isObj ? structuredClone(obj) : {};
  for (const [key, def] of Object.entries(schema)) {
    if (out[key] === undefined || out[key] === null) out[key] = structuredClone(def);
  }
  return out;
}
