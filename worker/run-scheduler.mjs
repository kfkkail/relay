export const DEFAULT_MAX_CONCURRENT_RUNS = 5;

export async function fillAvailableSlots({
  activeRuns,
  claim,
  run,
  maxConcurrency = DEFAULT_MAX_CONCURRENT_RUNS,
}) {
  while (activeRuns.size < maxConcurrency) {
    const claimed = await claim();
    if (!claimed) break;

    let activeRun;
    activeRun = Promise.resolve()
      .then(() => run(claimed))
      .finally(() => activeRuns.delete(activeRun));
    activeRuns.add(activeRun);
  }
}
