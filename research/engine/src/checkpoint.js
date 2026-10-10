import nodeFs from 'node:fs';
import nodePath from 'node:path';

// Checkpoint store: in-memory map of key -> JSON-serializable state, optionally
// persisted to a JSON file at `path`. Writes are atomic (tmp file + rename).
// Without `path` the store is memory-only. `fs` is injectable (sync API:
// readFileSync, writeFileSync, renameSync, mkdirSync). States are stored and
// returned as copies, so callers can't mutate stored data.
export function createCheckpointStore({ path, fs = nodeFs } = {}) {
  if (path !== undefined && (typeof path !== 'string' || path === '')) {
    throw new TypeError('path must be a non-empty string');
  }
  const data = new Map();

  if (path !== undefined) {
    let text = null;
    try {
      text = fs.readFileSync(path, 'utf8');
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
    }
    if (text !== null) {
      const parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`invalid checkpoint file: ${path}`);
      }
      for (const [k, v] of Object.entries(parsed)) data.set(k, v);
    }
  }

  function flush() {
    if (path === undefined) return;
    const tmp = `${path}.tmp`;
    fs.mkdirSync(nodePath.dirname(path), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(data)));
    fs.renameSync(tmp, path);
  }

  function checkKey(key) {
    if (typeof key !== 'string' || key === '') throw new TypeError('key must be a non-empty string');
  }

  function save(key, state) {
    checkKey(key);
    const json = JSON.stringify(state);
    if (json === undefined) throw new TypeError('state must be JSON-serializable');
    const had = data.has(key);
    const prev = data.get(key);
    data.set(key, JSON.parse(json));
    try {
      flush();
    } catch (err) {
      if (had) data.set(key, prev); else data.delete(key);
      throw err;
    }
  }

  // Returns undefined when the key has no checkpoint.
  function load(key) {
    checkKey(key);
    return data.has(key) ? structuredClone(data.get(key)) : undefined;
  }

  // Returns true if a checkpoint was removed.
  function clear(key) {
    checkKey(key);
    if (!data.has(key)) return false;
    const prev = data.get(key);
    data.delete(key);
    try {
      flush();
    } catch (err) {
      data.set(key, prev);
      throw err;
    }
    return true;
  }

  // Keys of all stored checkpoints, in insertion order.
  function keys() {
    return [...data.keys()];
  }

  return { save, load, clear, keys };
}
