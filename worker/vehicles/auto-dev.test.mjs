import { describe, expect, it, vi } from "vitest";
import {
  collectAutoDev,
  normalizeAutoDev,
  rivianAttributes,
} from "./auto-dev.mjs";
import { autoDevKey } from "./credentials.mjs";

const sample = (vin = "7FCTGAAA0NN000001", series = "Adventure") => ({
  vehicle: {
    vin,
    make: "Rivian",
    model: "R1T",
    year: 2023,
    trim: "Adventure",
    series,
  },
  retailListing: {
    price: 49999,
    miles: 12000,
    dealer: "Example Motors",
    zip: "46530",
    vdp: "https://example.com/truck",
    primaryImage: "https://example.com/truck.jpg",
    photoCount: 12,
  },
});
const response = (data, total, next = null) =>
  new Response(JSON.stringify({ data, total, links: { next } }), {
    headers: { "content-type": "application/json" },
  });
const collect = (fetchImpl, options = {}) =>
  collectAutoDev({
    key: "test-private-key",
    profile: { make: "Rivian", model: "R1T" },
    fetchImpl,
    sleep: async () => {},
    ...options,
  });

describe("Rivian evidence", () => {
  it.each([
    ["Adventure", null],
    ["Launch Edition", null],
    ["Dual Standard", "standard"],
    ["Standard+ Pack", "standard+"],
    ["Standard Plus Battery", "standard+"],
    ["Dual-Motor, Large Pack", "large"],
    ["Tri Max Battery", "max"],
  ])("parses %s conservatively", (series, expected) => {
    expect(rivianAttributes({ series }).battery_pack).toBe(expected);
  });
  it("does not resolve conflicting pack evidence", () => {
    expect(
      rivianAttributes({ series: "Max Pack", trim: "Standard" }).battery_pack,
    ).toBeNull();
  });
  it("retains unknown fees and freshness instead of guessing", () => {
    const row = normalizeAutoDev(sample(), { make: "Rivian", model: "R1T" });
    expect(row).toMatchObject({
      shipping: null,
      mandatory_fees: null,
      title_status: "unknown",
      source_updated_at: null,
    });
  });
});

describe("bounded Auto.dev collection", () => {
  it("follows clamped pages and preserves the search filters", async () => {
    const fake = vi
      .fn()
      .mockResolvedValueOnce(response([sample()], 2, "/listings?page=2"))
      .mockResolvedValueOnce(response([sample("7FCTGAAA0NN000002")], 2));
    const report = await collect(fake);
    expect(report.status).toBe("success");
    expect(report.counts).toMatchObject({ pages: 2, parsed: 2, reported: 2 });
    expect(
      new URL(fake.mock.calls[1][0]).searchParams.get("vehicle.model"),
    ).toBe("R1T");
  });
  it("marks a reported-count discrepancy Partial", async () => {
    const report = await collect(async () => response([sample()], 3));
    expect(report.status).toBe("partial");
    expect(report.warnings).toContain("count_mismatch");
  });
  it("deduplicates VINs but flags unstable pagination", async () => {
    const report = await collect(async () => response([sample(), sample()], 2));
    expect(report.listings).toHaveLength(1);
    expect(report.warnings).toContain("duplicate_vins");
  });
  it("never sends authorization to an off-origin pagination link", async () => {
    const fake = vi.fn(async () =>
      response([sample()], 2, "https://evil.example/listings?page=2"),
    );
    const report = await collect(fake);
    expect(fake).toHaveBeenCalledTimes(1);
    expect(report.warnings).toContain("unsafe_pagination");
  });
  it("bounds looping and large enumerations", async () => {
    const report = await collect(
      async () => response([sample()], 2, "/listings?page=2"),
      { maxPages: 1 },
    );
    expect(report.status).toBe("partial");
    expect(report.warnings).toContain("collection_limit");
  });
  it("retries transient limits and keeps error bodies out of output", async () => {
    const fake = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("secret-provider-diagnostic", { status: 429 }),
      )
      .mockResolvedValueOnce(response([], 0));
    const report = await collect(fake);
    expect(report.status).toBe("success");
    expect(report.counts.requests).toBe(2);
    expect(JSON.stringify(report)).not.toContain("secret-provider-diagnostic");
  });
  it("classifies forbidden access and malformed responses visibly", async () => {
    expect(
      (await collect(async () => new Response("private", { status: 403 })))
        .status,
    ).toBe("blocked");
    expect((await collect(async () => new Response("{}"))).status).toBe(
      "failed",
    );
  });
  it("rejects wrong-model rows instead of ingesting them", async () => {
    const wrong = sample();
    wrong.vehicle.model = "R1S";
    const report = await collect(async () => response([wrong], 1));
    expect(report.counts.invalid).toBe(1);
    expect(report.status).toBe("partial");
  });
});

describe("worker secret retrieval", () => {
  it("uses a process secret when configured", async () => {
    expect(await autoDevKey({ env: { AUTODEV_API_KEY: " test " } })).toBe(
      "test",
    );
  });
  it("never forwards Keychain diagnostic text", async () => {
    await expect(
      autoDevKey({
        env: {},
        platform: "darwin",
        run: async () => {
          throw new Error("secret-data");
        },
      }),
    ).rejects.toThrow("unavailable");
  });
});
