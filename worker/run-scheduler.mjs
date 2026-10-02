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
