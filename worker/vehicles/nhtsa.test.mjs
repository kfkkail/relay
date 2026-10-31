import { describe, expect, it, vi } from "vitest";
import { decodeNhtsa, decodeNhtsaResult, freshNhtsa } from "./nhtsa.mjs";

const vin = "7FCTGAAL6NN005487";
const source = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`;
const payload = (patch = {}) => ({
  Results: [
    {
      VIN: vin,
      ErrorCode: "0",
      Make: "RIVIAN",
      Model: "R1T",
      ModelYear: "2022",
      EVDriveUnit: "Quad Motor",
      BatteryKWh: "128.90",
      BatteryInfo: "",
      ...patch,
    },
  ],
});
describe("NHTSA VIN evidence", () => {
  it("records explicit motor and capacity without inventing a pack", () => {
    expect(decodeNhtsaResult(payload(), vin, source)).toMatchObject({
      vin,
      status: "decoded",
      battery_kwh: 128.9,
      attributes: {
        motor: "quad",
        battery_pack: null,
        battery_evidence: null,
        motor_evidence: "NHTSA EVDriveUnit: Quad Motor",
      },
    });
  });
  it("treats missing/ambiguous fields as unknown", () => {
    expect(
      decodeNhtsaResult(
        payload({ EVDriveUnit: "__proto__", BatteryInfo: "constructor" }),
        vin,
        source,
      ).attributes,
    ).toMatchObject({ motor: null, battery_pack: null });
    expect(
      decodeNhtsaResult(
        payload({
          EVDriveUnit: "",
          BatteryKWh: "",
          BatteryInfo: "Large Pack or Max Pack",
        }),
        vin,
        source,
      ),
    ).toMatchObject({
      battery_kwh: null,
      attributes: { motor: null, battery_pack: null },
    });
    expect(
      decodeNhtsaResult(
        payload({ EVDriveUnit: "Triple Motor", BatteryInfo: "Max Pack" }),
        vin,
        source,
      ).attributes,
    ).toMatchObject({ motor: "tri", battery_pack: "max" });
  });
  it("rejects partial, erroneous or mismatched decoding", () => {
    for (const data of [
      payload({ VIN: "7FCTGAAL6NN005488" }),
      payload({ ErrorCode: "5" }),
      payload({ ErrorCode: "" }),
      { Results: [] },
      { Results: payload().Results.concat(payload().Results) },
    ])
      expect(() => decodeNhtsaResult(data, vin, source)).toThrow(
        "cleanly decode",
      );
  });
  it("uses a fixed public endpoint, model year, timeout and no credentials", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(payload())),
    );
    await decodeNhtsa(vin, { year: 2022, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${source}&modelyear=2022`,
      expect.objectContaining({
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
    await expect(decodeNhtsa("bad", { fetchImpl })).rejects.toThrow(
      "valid VIN",
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("rejects HTTP failures and oversized payloads", async () => {
    await expect(
      decodeNhtsa(vin, {
        fetchImpl: async () => new Response(null, { status: 429 }),
      }),
    ).rejects.toThrow("HTTP 429");
    await expect(
      decodeNhtsa(vin, {
        fetchImpl: async () => new Response("x".repeat(200001)),
      }),
    ).rejects.toThrow("too_large");
  });
  it("caches only clean results for the same VIN for 30 days", () => {
    const now = Date.now();
    const value = {
      vin,
      status: "decoded",
      checked_at: new Date(now).toISOString(),
    };
    expect(freshNhtsa(value, vin, now)).toBe(true);
    expect(freshNhtsa(value, vin, now + 31 * 86400_000)).toBe(false);
    expect(freshNhtsa(value, "other", now)).toBe(false);
    expect(freshNhtsa({ ...value, status: "failed" }, vin, now)).toBe(false);
  });
});
