import { describe, expect, it, vi } from "vitest";
import { runVehicleJob, vehicleCapabilities } from "./handler.mjs";
import { SellerPageError } from "./seller-error.mjs";

describe("vehicle worker routing", () => {
  it("reports a blocked detail job once and logs the real reason", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const request = vi.fn(async () => ({ result: null }));
      const result = await runVehicleJob(
        {
          run: {
            id: "blocked-run",
            lease: "lease",
            job_payload: { detail_vehicle: "vehicle" },
          },
        },
        request,
        {
          detail: async () => {
            throw new SellerPageError(
              "access_denied",
              "https://www.carvana.com/vehicle/123?secret=private",
              { httpStatus: 403 },
            );
          },
          getKey: () => {
            throw new Error("must not request credentials");
          },
        },
      );
      expect(result).toEqual({ enrichment_failed: true });
      expect(request).toHaveBeenCalledTimes(2);
      expect(JSON.parse(request.mock.calls[0][1].body).action).toBe("nhtsa");
      expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
        action: "enrichment_failure",
        lease: "lease",
        failure: {
          code: "access_denied",
          host: "www.carvana.com",
          http_status: 403,
        },
      });
      expect(log.mock.calls[0][0]).toContain(
        "blocked-run could not check configuration: www.carvana.com: seller denied automated access (HTTP 403)",
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain("private");
    } finally {
      log.mockRestore();
    }
  });
  it("advertises only with explicit worker opt-in", () => {
    expect(vehicleCapabilities({})).toEqual([]);
    expect(vehicleCapabilities({ RELAY_VEHICLE_SEARCH: "1" })).toEqual([
      "vehicle_search",
      "vehicle_enrichment",
    ]);
  });
  it("still checks the seller if NHTSA is unavailable", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const detail = vi.fn(async () => ({}));
    const request = vi.fn(async (_, init) => {
      if (JSON.parse(init.body).action === "nhtsa")
        throw new Error("government API unavailable");
      return { result: null };
    });
    try {
      await runVehicleJob(
        { run: { id: "detail", job_payload: { detail_vehicle: "vehicle" } } },
        request,
        { detail },
      );
      expect(detail).toHaveBeenCalledOnce();
      expect(JSON.parse(request.mock.calls.at(-1)[1].body).action).toBe(
        "enrichment",
      );
    } finally {
      log.mockRestore();
    }
  });
  it("runs a targeted check without an Auto.dev credential or inventory scan", async () => {
    const request = vi.fn(async () => ({ result: null }));
    const getKey = vi.fn();
    const collect = vi.fn();
    const attributes = { battery_pack: "large", motor: "quad" };
    const payload = {
      detail_vehicle: "vehicle",
      detail_vin: "7FCTGAAA0NN000001",
      detail_url: "https://dealer.example/truck",
    };
    const detail = vi.fn(async () => attributes);
    await runVehicleJob(
      { run: { id: "detail", lease: "lease", job_payload: payload } },
      request,
      { getKey, collect, detail },
    );
    expect(detail).toHaveBeenCalledWith(payload);
    expect(getKey).not.toHaveBeenCalled();
    expect(collect).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(request.mock.calls[0][1].body).action).toBe("nhtsa");
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
      action: "enrichment",
      lease: "lease",
      attributes,
    });
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
      {
        getKey: async () => "test-secret",
        collect,
        nhtsa: async () => {},
        enrich: async ({ listings }) => ({
          listings,
          counts: {
            detail_attempted: 0,
            detail_resolved: 0,
            detail_failed: 0,
          },
        }),
      },
    );
    expect(request).toHaveBeenCalledTimes(4);
    expect(JSON.parse(request.mock.calls[0][1].body).listings).toHaveLength(50);
    expect(JSON.parse(request.mock.calls[2][1].body).listings).toHaveLength(1);
    expect(JSON.parse(request.mock.calls[3][1].body).action).toBe("finalize");
    expect(
      JSON.parse(request.mock.calls[3][1].body).health.counts.detail_attempted,
    ).toBe(0);
    expect(JSON.stringify(request.mock.calls)).not.toContain("test-secret");
    expect(
      request.mock.calls.every(
        ([, init]) => init.signal instanceof AbortSignal,
      ),
    ).toBe(true);
  });
});
