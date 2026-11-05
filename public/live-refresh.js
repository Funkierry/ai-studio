// One load at a time. A refresh asked for while one is running gets a fresh load
// right after it, because the running one may have read the data before the click.
export function createRefresher(load) {
  let running = null, queued = null;
  const start = () => {
    running = Promise.resolve().then(load).finally(() => { running = null; });
    return running;
  };
  return {
    // after the boss did something: the answer must reflect it
    now() {
      if (!running) return start();
      queued ??= running.catch(() => {}).then(() => { queued = null; return start(); });
      return queued;
    },
    // the regular tick: skipped while a load is already under way
    poll() { if (!running && !queued) start().catch(() => {}); },
  };
}
