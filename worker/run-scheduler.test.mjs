import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_CONCURRENT_RUNS,
  fillAvailableSlots,
  nextIdlePollInterval,
  pollForWork,
  pollingIntervals,
} from "./run-scheduler.mjs";

describe("fillAvailableSlots", () => {
  it("starts up to five runs concurrently", async () => {
    const activeRuns = new Set();
    const releases = [];
    let nextRun = 1;
    const claim = vi.fn(async () => ({ id: nextRun++ }));
    const run = vi.fn(() => new Promise((resolve) => releases.push(resolve)));

    const claimedRuns = await fillAvailableSlots({ activeRuns, claim, run });

    expect(DEFAULT_MAX_CONCURRENT_RUNS).toBe(5);
    expect(claim).toHaveBeenCalledTimes(5);
    expect(run).toHaveBeenCalledTimes(5);
    expect(activeRuns.size).toBe(5);
    expect(claimedRuns).toBe(5);

    releases.forEach((release) => release());
    await Promise.all([...activeRuns]);
    expect(activeRuns.size).toBe(0);
  });

  it("stops claiming when the queue is empty", async () => {
    const activeRuns = new Set();
    const claim = vi.fn(async () => null);
    const run = vi.fn();

    const claimedRuns = await fillAvailableSlots({ activeRuns, claim, run });

    expect(claim).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
    expect(claimedRuns).toBe(0);
  });

  it("removes a run from the active pool when it settles", async () => {
    const activeRuns = new Set();
    const claim = vi
      .fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce(null);

    await fillAvailableSlots({
      activeRuns,
      claim,
      run: async () => {},
    });
    await Promise.all([...activeRuns]);

    expect(activeRuns.size).toBe(0);
  });
});

describe("nextIdlePollInterval", () => {
  const options = { baseInterval: 5_000, maxInterval: 60_000 };

  it("doubles the delay while the worker remains idle", () => {
    expect(nextIdlePollInterval(5_000, options)).toBe(10_000);
    expect(nextIdlePollInterval(10_000, options)).toBe(20_000);
  });

  it("caps the idle delay at the configured maximum", () => {
    expect(nextIdlePollInterval(40_000, options)).toBe(60_000);
    expect(nextIdlePollInterval(60_000, options)).toBe(60_000);
  });
});

describe("pollForWork", () => {
  it("claims queued work before considering maintenance", async () => {
    const activeRuns = new Set();
    const maintain = vi.fn();
    const claim = vi
      .fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValue(null);
    const run = vi.fn(async () => {});
    expect(await pollForWork({ activeRuns, claim, run, maintain })).toBe(1);
    await Promise.all([...activeRuns]);
    expect(run).toHaveBeenCalledOnce();
    expect(maintain).not.toHaveBeenCalled();
  });

  it("maintains only after a successful empty queue check", async () => {
    const order = [];
    await pollForWork({
      activeRuns: new Set(),
      claim: async () => {
        order.push("claim");
        return null;
      },
      run: vi.fn(),
      maintain: async () => {
        order.push("maintain");
      },
    });
    expect(order).toEqual(["claim", "maintain"]);
  });

  it("does not maintain while another run is active", async () => {
    const maintain = vi.fn();
    await pollForWork({
      activeRuns: new Set([new Promise(() => {})]),
      claim: async () => null,
      run: vi.fn(),
      maintain,
    });
    expect(maintain).not.toHaveBeenCalled();
  });

  it("does not assume the queue is empty when claiming fails", async () => {
    const maintain = vi.fn();
    await expect(
      pollForWork({
        activeRuns: new Set(),
        claim: async () => {
          throw new Error("offline");
        },
        run: vi.fn(),
        maintain,
      }),
    ).rejects.toThrow("offline");
    expect(maintain).not.toHaveBeenCalled();
  });
});

describe("pollingIntervals", () => {
  it("keeps the default idle wait at five seconds even after many empty claims", () => {
    const options = pollingIntervals();
    let delay = options.baseInterval;
    for (let i = 0; i < 100; i++) delay = nextIdlePollInterval(delay, options);
    expect(delay).toBe(5000);
  });

  it("defaults the cap to a custom base interval", () => {
    expect(pollingIntervals({ RELAY_POLL_INTERVAL_MS: "2000" })).toEqual({
      baseInterval: 2000,
      maxInterval: 2000,
    });
  });

  it("preserves explicit idle backoff for lower request volume", () => {
    const options = pollingIntervals({
      RELAY_MAX_IDLE_POLL_INTERVAL_MS: "60000",
    });
    expect(nextIdlePollInterval(40000, options)).toBe(60000);
  });

  it.each([
    { RELAY_POLL_INTERVAL_MS: "NaN" },
    { RELAY_POLL_INTERVAL_MS: "0" },
    { RELAY_MAX_IDLE_POLL_INTERVAL_MS: "Infinity" },
    { RELAY_MAX_IDLE_POLL_INTERVAL_MS: "1000" },
  ])("rejects invalid intervals instead of busy-looping: %j", (env) => {
    expect(() => pollingIntervals(env)).toThrow("RELAY_POLL_INTERVAL_MS");
  });
});
