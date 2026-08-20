import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_CONCURRENT_RUNS,
  fillAvailableSlots,
} from "./run-scheduler.mjs";

describe("fillAvailableSlots", () => {
  it("starts up to five runs concurrently", async () => {
    const activeRuns = new Set();
    const releases = [];
    let nextRun = 1;
    const claim = vi.fn(async () => ({ id: nextRun++ }));
    const run = vi.fn(() => new Promise((resolve) => releases.push(resolve)));

    await fillAvailableSlots({ activeRuns, claim, run });

    expect(DEFAULT_MAX_CONCURRENT_RUNS).toBe(5);
    expect(claim).toHaveBeenCalledTimes(5);
    expect(run).toHaveBeenCalledTimes(5);
    expect(activeRuns.size).toBe(5);

    releases.forEach((release) => release());
    await Promise.all([...activeRuns]);
    expect(activeRuns.size).toBe(0);
  });

  it("stops claiming when the queue is empty", async () => {
    const activeRuns = new Set();
    const claim = vi.fn(async () => null);
    const run = vi.fn();

    await fillAvailableSlots({ activeRuns, claim, run });

    expect(claim).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
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
