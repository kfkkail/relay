import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enrichSellerListings,
  fetchSellerPage,
  isPublicAddress,
  sellerPageAttributes,
} from "./detail-enrichment.mjs";

const directories = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

const listing = (vin, changes = {}) => ({
  vin,
  url: `https://dealer.example/${vin}`,
  price: 50_000,
  mileage: 20_000,
  availability: "available",
  attributes: {
    battery_pack: null,
    motor: null,
    battery_evidence: null,
  },
  ...changes,
});

describe("seller detail evidence", () => {
  it("accepts explicit battery and motor labels with an evidence excerpt", () => {
    expect(
      sellerPageAttributes(
        "<main>2023 R1T Adventure · Large Pack · Quad-Motor AWD</main>",
        "https://dealer.example/truck",
      ),
    ).toMatchObject({
      battery_pack: "large",
      motor: "quad",
      battery_evidence: expect.stringContaining("Large Pack"),
    });
  });

  it("does not infer a pack from generic large or maximum language", () => {
    expect(
      sellerPageAttributes(
        "Large cargo area with maximum towing capability",
        "https://dealer.example/truck",
      ).battery_pack,
    ).toBeNull();
  });

  it("keeps conflicting battery labels unresolved", () => {
    expect(
      sellerPageAttributes(
        "Compare Standard Pack, Large Pack, and Max Pack options",
        "https://dealer.example/truck",
      ).battery_pack,
    ).toBeNull();
  });
});

describe("bounded rotating enrichment", () => {
  it("persists resolved facts and reuses them without another request", async () => {
    const cachePath = await cache();
    const fetchPage = vi.fn(async () => "Large Battery Pack Dual-Motor");
    const first = await enrichSellerListings({
      listings: [listing("7FCTGAAA0NN000001")],
      profile: { make: "Rivian", model: "R1T" },
      cachePath,
      fetchPage,
      limit: 1,
      now: () => new Date("2026-10-29T12:00:00Z"),
    });
    expect(first.listings[0].attributes).toMatchObject({
      battery_pack: "large",
      motor: "dual",
    });
    expect(first.counts.detail_resolved).toBe(1);

    const second = await enrichSellerListings({
      listings: [listing("7FCTGAAA0NN000001")],
      profile: { make: "Rivian", model: "R1T" },
      cachePath,
      fetchPage,
      limit: 1,
    });
    expect(second.listings[0].attributes.battery_pack).toBe("large");
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(cachePath, "utf8")).version).toBe(1);
  });

  it("moves past a recently unresolved page on the next run", async () => {
    const cachePath = await cache();
    const firstVin = "7FCTGAAA0NN000001";
    const secondVin = "7FCTGAAA0NN000002";
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce("Adventure")
      .mockResolvedValueOnce("Max Pack Performance Dual-Motor");
    await enrichSellerListings({
      listings: [listing(firstVin), listing(secondVin, { price: 60_000 })],
      profile: { make: "Rivian", model: "R1T" },
      cachePath,
      fetchPage,
      limit: 1,
      now: () => new Date("2026-10-29T12:00:00Z"),
    });
    const second = await enrichSellerListings({
      listings: [listing(firstVin), listing(secondVin, { price: 60_000 })],
      profile: { make: "Rivian", model: "R1T" },
      cachePath,
      fetchPage,
      limit: 1,
      now: () => new Date("2026-10-30T12:00:00Z"),
    });
    expect(second.listings[1].attributes.battery_pack).toBe("max");
    expect(fetchPage.mock.calls[1][0]).toContain(secondVin);
  });
});

describe("seller page network boundary", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.2",
    "::1",
    "fc00::1",
  ])("blocks private address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it("revalidates redirect hosts and returns bounded HTML", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://inventory.example/truck" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("<p>Max Pack</p>", {
          headers: { "content-type": "text/html" },
        }),
      );
    const lookupImpl = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
    ]);
    await expect(
      fetchSellerPage("https://dealer.example/truck", {
        fetchImpl,
        lookupImpl,
      }),
    ).resolves.toContain("Max Pack");
    expect(lookupImpl).toHaveBeenCalledTimes(2);
  });

  it("refuses a host that resolves privately before fetching", async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchSellerPage("https://dealer.example/truck", {
        fetchImpl,
        lookupImpl: async () => [{ address: "10.0.0.1", family: 4 }],
      }),
    ).rejects.toThrow("unsafe_address");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

async function cache() {
  const directory = await mkdtemp(join(tmpdir(), "relay-vehicle-enrichment-"));
  directories.push(directory);
  return join(directory, "cache.json");
}
