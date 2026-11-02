import { describe, expect, it, vi } from "vitest";
import {
  decodeNhtsa,
  decodeNhtsaResult,
  freshNhtsa,
  rivianGen1Battery,
} from "./nhtsa.mjs";

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
  it("maps an exact Gen 1 R1T capacity and records its evidence", () => {
    expect(decodeNhtsaResult(payload(), vin, source)).toMatchObject({
      vin,
      status: "decoded",
      decoder_version: 2,
      battery_kwh: 128.9,
      attributes: {
        motor: "quad",
        battery_pack: "large",
        battery_evidence:
          "NHTSA BatteryKWh: 128.9 kWh (Rivian Gen 1 large capacity map)",
        motor_evidence: "NHTSA EVDriveUnit: Quad Motor",
      },
    });
  });
  it.each([
    [106, "standard"],
    [121, "standard+"],
    [128.9, "large"],
    [131, "large"],
    [141, "max"],
    [142, "large+"],
    [142.3, "large+"],
  ])("maps the documented Gen 1 capacity %s to %s", (capacity, pack) => {
    expect(
      rivianGen1Battery(capacity, {
        year: "2024",
        make: "RIVIAN",
        model: "R1T",
      })?.pack,
    ).toBe(pack);
  });
  it("does not use the capacity map for another generation, model, or value", () => {
    for (const [capacity, identity] of [
      [130, { year: "2024", make: "RIVIAN", model: "R1T" }],
      [128.9, { year: "2025", make: "RIVIAN", model: "R1T" }],
      [128.9, { year: "2024", make: "RIVIAN", model: "R1S" }],
      [128.9, { year: "2024", make: "FORD", model: "F-150" }],
    ])
      expect(rivianGen1Battery(capacity, identity)).toBeNull();
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
    expect(
      decodeNhtsaResult(payload({ BatteryInfo: "Large+ Pack" }), vin, source)
        .attributes.battery_pack,
    ).toBe("large+");
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
      decoder_version: 2,
      checked_at: new Date(now).toISOString(),
    };
    expect(freshNhtsa(value, vin, now)).toBe(true);
    expect(freshNhtsa(value, vin, now + 31 * 86400_000)).toBe(false);
    expect(freshNhtsa(value, "other", now)).toBe(false);
    expect(freshNhtsa({ ...value, status: "failed" }, vin, now)).toBe(false);
    expect(freshNhtsa({ ...value, decoder_version: 1 }, vin, now)).toBe(false);
  });
});
