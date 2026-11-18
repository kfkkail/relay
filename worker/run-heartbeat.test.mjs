import { describe, expect, it, vi } from "vitest";
import { startRunHeartbeat } from "./run-heartbeat.mjs";

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
});
