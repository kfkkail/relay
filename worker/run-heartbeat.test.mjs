import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HEARTBEAT_LOSS_TIMEOUT_MS,
  renewRunHeartbeat,
  startRunHeartbeat,
  validateHeartbeatInterval,
} from "./run-heartbeat.mjs";
import { createRelayClient, RelayHttpError } from "./relay-client.mjs";

afterEach(() => vi.useRealTimers());
function start(options = {}) {
  return startRunHeartbeat({
    intervalMs: 30_000,
    heartbeat: vi.fn().mockResolvedValue(undefined),
    now: Date.now,
    ...options,
  });
}

describe("agent run heartbeat", () => {
  it.each([0, 999, 60_001, 300_000, NaN, Infinity])(
    "rejects unsafe heartbeat interval %s",
    (intervalMs) =>
      expect(() => validateHeartbeatInterval(intervalMs)).toThrow(
        "between 1000 and 60000",
      ),
  );

  it.each([null, {}, { heartbeat: false }, { heartbeat: "true" }])(
    "rejects an unacknowledged renewal: %j",
    async (receipt) => {
      await expect(
        renewRunHeartbeat(vi.fn().mockResolvedValue(receipt), "run-1"),
      ).rejects.toMatchObject({ code: "INVALID_RELAY_RESPONSE" });
    },
  );

  it("requires a positive acknowledgment and forwards cancellation", async () => {
    const request = vi.fn().mockResolvedValue({ heartbeat: true });
    const controller = new AbortController();
    await renewRunHeartbeat(request, "run-1", controller.signal);
    expect(request).toHaveBeenCalledWith("/api/worker/runs/run-1/heartbeat", {
      method: "POST",
      signal: controller.signal,
    });
  });

  it("renews immediately and at the normal interval until stopped", async () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const session = start({ heartbeat });
    await session.ready;
    expect(heartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(heartbeat).toHaveBeenCalledTimes(4);
    await session.stop();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(heartbeat).toHaveBeenCalledTimes(4);
    expect(session.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries transient failures with backoff, recovers, then resets the backoff", async () => {
    vi.useFakeTimers();
    const onError = vi.fn(),
      onRecovered = vi.fn();
    const heartbeat = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new RelayHttpError("database unavailable", 503))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("offline again"))
      .mockResolvedValue(undefined);
    const session = start({ heartbeat, onError, onRecovered });
    await session.ready;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1 + 5000);
    expect(heartbeat).toHaveBeenCalledTimes(4);
    expect(onRecovered).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000 + 2000);
    expect(heartbeat).toHaveBeenCalledTimes(6);
    expect(onRecovered).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(3);
    expect(session.signal.aborted).toBe(false);
    await session.stop();
  });

  it.each([400, 401, 403, 404, 410])(
    "cancels immediately on HTTP %s",
    async (status) => {
      vi.useFakeTimers();
      const heartbeat = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue(new RelayHttpError("rejected", status));
      const session = start({ heartbeat });
      await session.ready;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(session.signal.aborted).toBe(true);
      expect(session.signal.reason.message).toContain(
        "Worker heartbeat rejected",
      );
      await vi.advanceTimersByTimeAsync(300_000);
      expect(heartbeat).toHaveBeenCalledTimes(2);
      await session.stop();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("does not start external work until an initial transient failure recovers", async () => {
    vi.useFakeTimers();
    const heartbeat = vi
      .fn()
      .mockRejectedValueOnce(new RelayHttpError("busy", 503))
      .mockResolvedValue(undefined);
    const session = start({ heartbeat });
    const run = vi.fn();
    const started = session.ready.then(run);
    await vi.advanceTimersByTimeAsync(1999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await started;
    expect(run).toHaveBeenCalledOnce();
    await session.stop();
  });

  it("bounds Retry-After with the independent four-minute watchdog", async () => {
    vi.useFakeTimers();
    const heartbeat = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new RelayHttpError("rate limited", 429, 600_000));
    const session = start({ heartbeat });
    await session.ready;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_LOSS_TIMEOUT_MS - 1);
    expect(session.signal.aborted).toBe(false);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.signal.aborted).toBe(true);
    expect(session.signal.reason.message).toContain("four minutes");
    await session.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resets the loss deadline after recovery and never renews again once lost", async () => {
    vi.useFakeTimers();
    let offline = false;
    const heartbeat = vi.fn(async () => {
      if (offline) throw new Error("offline");
    });
    const session = start({ heartbeat });
    await session.ready;
    await vi.advanceTimersByTimeAsync(180_000);
    offline = true;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_LOSS_TIMEOUT_MS - 1);
    expect(session.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.signal.aborted).toBe(true);
    const count = heartbeat.mock.calls.length;
    offline = false;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(heartbeat).toHaveBeenCalledTimes(count);
    await session.stop();
  });

  it("cancels a stuck initial request at the watchdog deadline", async () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn(
      (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const session = start({ heartbeat });
    const failure = expect(session.ready).rejects.toThrow("four minutes");
    await vi.advanceTimersByTimeAsync(HEARTBEAT_LOSS_TIMEOUT_MS);
    await failure;
    expect(session.signal.aborted).toBe(true);
    await session.stop();
    expect(heartbeat).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a late acknowledgment after suspension before releasing waiting work", async () => {
    vi.useFakeTimers();
    let acknowledge;
    const heartbeat = vi.fn(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const session = start({ heartbeat });
    const run = vi.fn();
    const pending = session.ready.then(run);
    const failure = expect(pending).rejects.toThrow(
      "heartbeat deadline passed",
    );
    // Move wall time without firing timers, as when a response resumes before
    // overdue timer callbacks get their turn after a suspended event loop.
    vi.setSystemTime(Date.now() + 5 * 60_000);
    acknowledge();
    await failure;
    expect(run).not.toHaveBeenCalled();
    expect(session.signal.aborted).toBe(true);
    await session.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers from a stuck HTTP connection and renews beyond five minutes", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(
        (_url, { signal }) =>
          new Promise((_, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason));
          }),
      )
      .mockImplementation(() =>
        Promise.resolve(Response.json({ heartbeat: true })),
      );
    const client = createRelayClient({
      relayUrl: "https://relay.test",
      workerToken: "relay_test",
      fetchImpl,
    });
    const onError = vi.fn();
    const session = start({
      heartbeat: (signal) => renewRunHeartbeat(client.request, "run-1", signal),
      onError,
    });
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    await session.ready;
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toContain("timed out");
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(session.signal.aborted).toBe(false);
    await session.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts in-flight renewal during clean shutdown without marking the task lost", async () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn(
      (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const session = start({ heartbeat });
    await session.stop();
    expect(session.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
