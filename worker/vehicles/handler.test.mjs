import { describe, expect, it, vi } from "vitest";
import { runVehicleJob, vehicleCapabilities } from "./handler.mjs";

describe("vehicle worker routing", () => {
  it("advertises only with explicit worker opt-in", () => {
    expect(vehicleCapabilities({})).toEqual([]);
    expect(vehicleCapabilities({ RELAY_VEHICLE_SEARCH: "1" })).toEqual([
      "vehicle_search",
    ]);
  });
  it("uploads bounded idempotent batches and finalizes without the credential", async () => {
    const request = vi.fn(async () => ({ result: "done" }));
    const collect = vi.fn(async () => ({
      version: 1,
      status: "success",
      listings: Array.from({ length: 101 }, (_, id) => ({ id })),
    }));
    await runVehicleJob(
      { run: { id: "run-1" }, profile: { make: "Rivian", model: "R1T" } },
      request,
      { getKey: async () => "test-secret", collect },
    );
    expect(request).toHaveBeenCalledTimes(4);
    expect(JSON.parse(request.mock.calls[0][1].body).listings).toHaveLength(50);
    expect(JSON.parse(request.mock.calls[2][1].body).listings).toHaveLength(1);
    expect(JSON.parse(request.mock.calls[3][1].body).action).toBe("finalize");
    expect(JSON.stringify(request.mock.calls)).not.toContain("test-secret");
    expect(
      request.mock.calls.every(
        ([, init]) => init.signal instanceof AbortSignal,
      ),
    ).toBe(true);
  });
});
