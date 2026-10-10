// Crash recovery: replays unfinished checkpoints through handlers.
// A checkpoint state is an object `{ handler: string, done?: boolean, ... }`.
// Unfinished = `done` is not true. Each is passed to `handlers[state.handler](state, key)`.
// On success the checkpoint is cleared; on failure it is kept for a later retry.
// States with no matching handler (or malformed) are skipped and left untouched.
// Returns `{ resumed: key[], failed: { key, error }[], skipped: key[] }`.
export async function resumeJobs(store, handlers = {}) {
  if (!store || typeof store.keys !== 'function') throw new TypeError('store must provide keys()');
  const result = { resumed: [], failed: [], skipped: [] };
  for (const key of store.keys()) {
    const state = store.load(key);
    if (state === undefined || state?.done === true) continue;
    const name = state?.handler;
    const handler = typeof name === 'string' && Object.hasOwn(handlers, name) ? handlers[name] : undefined;
    if (typeof handler !== 'function') {
      result.skipped.push(key);
      continue;
    }
    try {
      await handler(state, key);
      store.clear(key);
      result.resumed.push(key);
    } catch (error) {
      result.failed.push({ key, error });
    }
  }
  return result;
}
