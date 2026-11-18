import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_CONCURRENT_RUNS,
  fillAvailableSlots,
  nextIdlePollInterval,
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
