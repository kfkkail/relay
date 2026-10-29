import { describe, expect, it } from "vitest";
import {
  defaultVehicleProfile as profile,
  distanceMiles,
  evaluateVehicle,
  materialVehicleChange,
} from "./domain";
import { inVehicleQueue, reviewVehicle } from "./review";
import {
  parseVehicleHealth,
  parseVehicleListing,
  parseVehicleProfile,
} from "./validation";
import type { VehicleListing, VehicleRecord } from "./types";

const listing = (changes: Partial<VehicleListing> = {}) =>
  parseVehicleListing({
    source_listing_id: "7FCTGAAA0NN000001",
    vin: "7FCTGAAA0NN000001",
    make: "Rivian",
    model: "R1T",
    year: 2023,
    attributes: { battery_pack: "large" },
    price: 50000,
    mileage: 30000,
    seller: "Example Dealer",
    url: "https://example.com/truck",
    shipping: 0,
    mandatory_fees: 0,
    delivery: "pickup",
    ...changes,
  });
const record = (changes: Partial<VehicleRecord> = {}): VehicleRecord => ({
  id: "vehicle-1",
  vin: "7FCTGAAA0NN000001",
  decision: "unreviewed",
  decision_revision: 0,
  first_seen_at: "2026-10-28T12:00:00Z",
  last_seen_at: "2026-10-28T12:00:00Z",
  overrides: {},
  vehicle_listings: [
    {
      id: "listing-1",
      data: listing(),
      availability: "available",
      last_seen_at: "2026-10-28T12:00:00Z",
    },
  ],
  ...changes,
});

describe("vehicle hard rules", () => {
  it("allows missing history with a warning", () => {
    expect(evaluateVehicle(listing(), profile)).toMatchObject({
      eligibility: "eligible",
      warnings: ["History unverified"],
    });
  });
  it("routes unknown battery to verification and rejects Standard", () => {
    expect(
      evaluateVehicle(
        listing({
          attributes: {
            battery_pack: null,
            motor: null,
            battery_evidence: null,
          },
        }),
        profile,
      ).eligibility,
    ).toBe("needs_verification");
    expect(
      evaluateVehicle(
        listing({
          attributes: {
            battery_pack: "standard",
            motor: null,
            battery_evidence: "seller",
          },
        }),
        profile,
      ).eligibility,
    ).toBe("ineligible");
  });
  it("does not hide missing shipping or fees in a score", () => {
    expect(
      evaluateVehicle(listing({ delivery: "unknown", shipping: null }), profile)
        .effective_cost,
    ).toBeNull();
    expect(
      evaluateVehicle(listing({ mandatory_fees: null }), profile).eligibility,
    ).toBe("needs_verification");
  });
  it("uses confirmed pickup as zero shipping and includes mandatory fees", () => {
    expect(
      evaluateVehicle(
        listing({ delivery: "pickup", shipping: null, mandatory_fees: 900 }),
        profile,
      ).effective_cost,
    ).toBe(50900);
  });
  it("fails an excessive advertised price even when costs are incomplete", () => {
    expect(
      evaluateVehicle(listing({ price: 75000, shipping: null }), profile)
        .eligibility,
    ).toBe("ineligible");
  });
  it("excludes title problems and unavailable listings", () => {
    expect(
      evaluateVehicle(listing({ title_status: "salvage" }), profile)
        .eligibility,
    ).toBe("ineligible");
    expect(
      evaluateVehicle(listing({ availability: "unavailable" }), profile)
        .eligibility,
    ).toBe("ineligible");
  });
  it("never hard-excludes national inventory by distance", () => {
    expect(
      evaluateVehicle(listing({ coordinates: [-122.4, 37.8] }), profile)
        .eligibility,
    ).toBe("eligible");
  });
  it("scores mileage progressively", () => {
    expect(
      evaluateVehicle(listing({ mileage: 90000 }), profile).score,
    ).toBeLessThan(evaluateVehicle(listing({ mileage: 50000 }), profile).score);
  });
  it("uses bounded straight-line distances", () => {
    expect(distanceMiles([-86.11, 41.75], [-86.11, 41.75])).toBe(0);
    expect(distanceMiles(null, [-86, 41])).toBeNull();
  });
});

describe("durable review and re-evaluation", () => {
  it("does not let a prior clean-title override hide a newly reported title problem", () => {
    const r = record({ overrides: { title_status: "clean" } });
    r.vehicle_listings[0].data.title_status = "salvage";
    expect(reviewVehicle(r, profile)!.evaluation.eligibility).toBe(
      "ineligible",
    );
  });
  it("never returns passed inventory to other queues after a profile change", () => {
    const v = reviewVehicle(record({ decision: "passed" }), {
      ...profile,
      cost_ceiling: 100000,
    })!;
    for (const queue of ["unreviewed", "verification", "watch", "shortlist"])
      expect(inVehicleQueue(v, queue)).toBe(false);
    expect(inVehicleQueue(v, "passed")).toBe(true);
  });
  it("keeps watched vehicles visible after requirements change", () => {
    const v = reviewVehicle(record({ decision: "watch" }), {
      ...profile,
      allowed_batteries: ["max"],
    })!;
    expect(v.evaluation.eligibility).toBe("ineligible");
    expect(inVehicleQueue(v, "watch")).toBe(true);
  });
  it("prefers eligible listings and keeps all sources on one card", () => {
    const r = record();
    r.vehicle_listings.push({
      id: "other",
      data: listing({ price: 90000 }),
      availability: "available",
      last_seen_at: r.last_seen_at,
    });
    const v = reviewVehicle(r, profile)!;
    expect(v.sources).toHaveLength(2);
    expect(v.row.price).toBe(50000);
  });
  it("preserves owner verification across listing refreshes", () => {
    const v = reviewVehicle(
      record({
        overrides: {
          attributes: {
            battery_pack: "max",
            motor: null,
            battery_evidence: "verified",
          },
        },
      }),
      profile,
    )!;
    expect(v.row.attributes.battery_pack).toBe("max");
  });
});

describe("notifications and input validation", () => {
  it("applies the larger of $500 or 1% to watched price drops", () => {
    expect(
      materialVehicleChange(listing(), listing({ price: 49600 }), "watch"),
    ).toBe(false);
    expect(
      materialVehicleChange(listing(), listing({ price: 49500 }), "watch"),
    ).toBe(true);
    expect(
      materialVehicleChange(listing(), listing({ price: 49999 }), "shortlist"),
    ).toBe(true);
    expect(
      materialVehicleChange(listing(), listing({ price: 40000 }), "passed"),
    ).toBe(false);
  });
  it("rejects invalid VINs and drops executable URLs and unknown fields", () => {
    expect(() => listing({ vin: "bad" })).toThrow();
    expect(
      parseVehicleListing({
        ...listing(),
        url: "javascript:alert(1)",
        secret: "do-not-store",
      }),
    ).not.toHaveProperty("secret");
    expect(
      parseVehicleListing({ ...listing(), url: "javascript:alert(1)" }).url,
    ).toBeNull();
  });
  it("requires weights to total 100 and serializes only known profile fields", () => {
    expect(
      parseVehicleProfile({ ...profile, secret: "ignored" }),
    ).not.toHaveProperty("secret");
    expect(() =>
      parseVehicleProfile({
        ...profile,
        weights: { ...profile.weights, price: 40 },
      }),
    ).toThrow();
  });
  it("rejects malformed health counts and bounds warnings", () => {
    expect(() =>
      parseVehicleHealth({
        version: 1,
        source: "auto.dev",
        status: "success",
        counts: {},
        scope: {},
      }),
    ).toThrow();
  });
});
