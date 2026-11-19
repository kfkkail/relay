export function startRunHeartbeat({
  intervalMs,
  heartbeat,
  onError = () => {},
  schedule = setInterval,
  cancel = clearInterval,
}) {
  if (!Number.isFinite(intervalMs) || intervalMs < 1000)
    throw new Error(
      "Run heartbeat interval must be at least 1000 milliseconds.",
    );

  let inFlight;
  let stopped = false;
  const timer = schedule(() => {
    // Skip ticks during a request instead of accumulating stale renewals.
    if (stopped || inFlight) return;
    inFlight = Promise.resolve()
      .then(heartbeat)
      .catch(onError)
      .finally(() => {
        inFlight = undefined;
      });
  }, intervalMs);

  return async function stopRunHeartbeat() {
    stopped = true;
    cancel(timer);
    await inFlight;
  };
}
