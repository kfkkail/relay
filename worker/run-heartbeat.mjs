export const HEARTBEAT_LOSS_TIMEOUT_MS = 4 * 60_000;
const RETRY_DELAYS_MS = [2000, 5000, 10_000, 15_000];

export function validateHeartbeatInterval(intervalMs) {
  if (!Number.isFinite(intervalMs) || intervalMs < 1000 || intervalMs > 60_000)
    throw new Error(
      "Run heartbeat interval must be between 1000 and 60000 milliseconds to stay within Relay's five-minute expiry.",
    );
}

export async function renewRunHeartbeat(request, runId, signal) {
  const receipt = await request(`/api/worker/runs/${runId}/heartbeat`, {
    method: "POST",
    ...(signal ? { signal } : {}),
  });
  if (receipt?.heartbeat !== true)
    throw Object.assign(
      new Error(
        "Relay did not acknowledge the run heartbeat. Check RELAY_URL and deployment access.",
      ),
      { code: "INVALID_RELAY_RESPONSE" },
    );
}

export function isRetryableRelayError(error) {
  if (error?.code === "INVALID_RELAY_RESPONSE") return false;
  const status = error?.status;
  return (
    !status ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

// Start immediately, and let callers await ready before starting external work.
// A separate watchdog also expires an in-flight renewal that never settles.
export function startRunHeartbeat({
  intervalMs,
  heartbeat,
  onError = () => {},
  onRecovered = () => {},
  lossTimeoutMs = HEARTBEAT_LOSS_TIMEOUT_MS,
  // Wall time includes machine suspension, during which the server lease ages.
  now = Date.now,
}) {
  validateHeartbeatInterval(intervalMs);
  const controller = new AbortController();
  const requests = new AbortController();
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // The owner may still be preparing to await ready when a synchronous failure occurs.
  ready.catch(() => {});
  let stopped = false;
  let acknowledgedAt = now();
  let failures = 0;
  let nextTimer, deadlineTimer, inFlight;

  function deadlinePassed() {
    if (now() - acknowledgedAt < lossTimeoutMs) return false;
    loseLease(
      "Worker connection lost: the heartbeat deadline passed. Work was stopped because its run lease could no longer be confirmed. Review any partial work before retrying.",
    );
    return true;
  }

  function loseLease(message) {
    if (stopped || controller.signal.aborted) return;
    const error = new Error(message);
    clearTimeout(nextTimer);
    clearTimeout(deadlineTimer);
    controller.abort(error);
    requests.abort(error);
    rejectReady(error);
  }

  function armDeadline() {
    clearTimeout(deadlineTimer);
    deadlineTimer = setTimeout(
      () =>
        loseLease(
          "Worker connection lost: no acknowledged heartbeat for four minutes. Work was stopped because its run lease could no longer be confirmed. Review any partial work before retrying.",
        ),
      Math.max(0, lossTimeoutMs - (now() - acknowledgedAt)),
    );
  }

  async function renew() {
    if (stopped || controller.signal.aborted) return;
    if (deadlinePassed()) return;
    // Count a renewal from its send time, conservatively excluding round-trip time.
    const sentAt = now();
    let delay = intervalMs;
    try {
      await heartbeat(requests.signal);
      if (stopped || controller.signal.aborted) return;
      // Promise continuations can run before an overdue watchdog callback after
      // suspension. Never turn a late response into permission to start work.
      if (deadlinePassed()) return;
      acknowledgedAt = sentAt;
      armDeadline();
      resolveReady();
      if (failures) onRecovered();
      failures = 0;
    } catch (error) {
      if (stopped || controller.signal.aborted) return;
      failures++;
      onError(error);
      if (!isRetryableRelayError(error)) {
        loseLease(
          `Worker heartbeat rejected: ${error.message}. Work was stopped; review any partial work before retrying.`,
        );
        return;
      }
      delay = Math.max(
        RETRY_DELAYS_MS[Math.min(failures - 1, RETRY_DELAYS_MS.length - 1)],
        error?.retryAfterMs || 0,
      );
    }
    if (!stopped && !controller.signal.aborted)
      nextTimer = setTimeout(
        tick,
        Math.min(delay, Math.max(0, lossTimeoutMs - (now() - acknowledgedAt))),
      );
  }

  function tick() {
    inFlight = renew();
  }

  armDeadline();
  tick();
  return {
    ready,
    signal: controller.signal,
    async stop() {
      stopped = true;
      clearTimeout(nextTimer);
      clearTimeout(deadlineTimer);
      requests.abort();
      rejectReady(new Error("Run heartbeat stopped."));
      await inFlight;
    },
  };
}
