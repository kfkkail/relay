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

  let inFlight = Promise.resolve();
  const timer = schedule(() => {
    inFlight = inFlight.then(heartbeat, heartbeat).catch(onError);
  }, intervalMs);

  return async function stopRunHeartbeat() {
    cancel(timer);
    await inFlight;
  };
}
