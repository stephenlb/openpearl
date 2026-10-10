// Crash recovery: replay unfinished checkpoints through handlers.
//
// A checkpoint state is `{ type, done?, ...payload }`. `type` selects the
// handler from `handlers` (a plain object of name -> async fn(state, key)).
// Checkpoints marked `done`, or whose type has no handler, are skipped and left
// untouched. A handler that resolves gets its checkpoint cleared and is
// reported as resumed; one that throws keeps its checkpoint (so a later run can
// retry) and is reported as failed with the error. Returns
// `{ resumed: [key], failed: [{ key, error }], skipped: [key] }`.
export async function resumeJobs(store, handlers) {
  if (!store || typeof store.keys !== 'function' || typeof store.load !== 'function') {
    throw new TypeError('store must provide keys() and load()');
  }
  if (handlers === null || typeof handlers !== 'object') {
    throw new TypeError('handlers must be an object');
  }
  const report = { resumed: [], failed: [], skipped: [] };
  for (const key of store.keys()) {
    const state = store.load(key);
    const type = state?.type;
    const handler = typeof type === 'string' && Object.hasOwn(handlers, type) ? handlers[type] : undefined;
    if (state?.done === true || typeof handler !== 'function') {
      report.skipped.push(key);
      continue;
    }
    try {
      await handler(state, key);
      store.clear(key);
      report.resumed.push(key);
    } catch (error) {
      report.failed.push({ key, error });
    }
  }
  return report;
}
