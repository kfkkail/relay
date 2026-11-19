export const DEFAULT_MAX_CONCURRENT_RUNS = 5;

export async function fillAvailableSlots({
  activeRuns,
  claim,
  run,
  maxConcurrency = DEFAULT_MAX_CONCURRENT_RUNS,
}) {
  let claimedRuns = 0;
  while (activeRuns.size < maxConcurrency) {
    const claimed = await claim();
    if (!claimed) break;
    claimedRuns += 1;

    let activeRun;
    activeRun = Promise.resolve()
      .then(() => run(claimed))
      .finally(() => activeRuns.delete(activeRun));
    activeRuns.add(activeRun);
  }
  return claimedRuns;
}

export function nextIdlePollInterval(
  currentInterval,
  { baseInterval, maxInterval },
) {
  return Math.min(maxInterval, Math.max(baseInterval, currentInterval * 2));
}

// Maintenance may install dependencies or restart the worker. Only do it after
// a successful empty claim, never ahead of queued work or alongside active runs.
export async function pollForWork({ maintain, ...options }) {
  const claimedRuns = await fillAvailableSlots(options);
  if (claimedRuns === 0 && options.activeRuns.size === 0) await maintain();
  return claimedRuns;
}

export function pollingIntervals(env = {}) {
  const baseInterval = Number(env.RELAY_POLL_INTERVAL_MS || 5000);
  const maxInterval = Number(
    env.RELAY_MAX_IDLE_POLL_INTERVAL_MS || baseInterval,
  );
  if (
    !Number.isFinite(baseInterval) ||
    !Number.isFinite(maxInterval) ||
    baseInterval < 1000 ||
    maxInterval < baseInterval
  ) {
    throw new Error(
      "RELAY_POLL_INTERVAL_MS must be at least 1000 and RELAY_MAX_IDLE_POLL_INTERVAL_MS must be at least the polling interval.",
    );
  }
  return { baseInterval, maxInterval };
}
