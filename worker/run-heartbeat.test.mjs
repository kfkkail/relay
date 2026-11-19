import { afterEach, describe, expect, it, vi } from "vitest";
import { startRunHeartbeat } from "./run-heartbeat.mjs";
import { createRelayClient } from "./relay-client.mjs";

afterEach(() => vi.useRealTimers());

describe("agent run heartbeat", () => {
  it("renews a run until stopped", async () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const stop = startRunHeartbeat({ intervalMs: 1000, heartbeat });

    await vi.advanceTimersByTimeAsync(3000);
    expect(heartbeat).toHaveBeenCalledTimes(3);

    await stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(heartbeat).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("reports a failed renewal and continues heartbeating", async () => {
    vi.useFakeTimers();
    const error = new Error("offline");
    const heartbeat = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const stop = startRunHeartbeat({
      intervalMs: 1000,
      heartbeat,
      onError,
    });

    await vi.advanceTimersByTimeAsync(2000);
    expect(onError).toHaveBeenCalledWith(error);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    await stop();
    vi.useRealTimers();
  });

  it("does not queue renewals behind a slow request or send them after stop", async () => {
    vi.useFakeTimers();
    let release;
    const heartbeat = vi.fn(
      () => new Promise((resolve) => (release = resolve)),
    );
    const stop = startRunHeartbeat({ intervalMs: 1000, heartbeat });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    const stopped = stop();
    release();
    await stopped;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(heartbeat).toHaveBeenCalledTimes(1);
  });

  it("recovers from a stuck connection and renews beyond the five-minute expiry", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockImplementationOnce(
      (_url, { signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    fetchImpl.mockImplementation(() =>
      Promise.resolve(Response.json({ heartbeat: true })),
    );
    const client = createRelayClient({
      relayUrl: "https://relay.test",
      workerToken: "relay_test",
      fetchImpl,
    });
    const onError = vi.fn();
    const stop = startRunHeartbeat({
      intervalMs: 30_000,
      heartbeat: () => client.request("/heartbeat", { method: "POST" }),
      onError,
    });
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toContain("timed out");
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(10);
    await stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
