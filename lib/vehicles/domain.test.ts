import { describe, expect, it } from "vitest";
import {
  defaultVehicleProfile as profile,
  applyVehicleOverrides,
  listingVerificationKey,
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
  it("keeps missing shipping or fees visible without blocking initial review", () => {
    const unknownDelivery = evaluateVehicle(
      listing({ delivery: "unknown", shipping: null }),
      profile,
    );
    expect(unknownDelivery.effective_cost).toBeNull();
    expect(unknownDelivery.eligibility).toBe("eligible");
    expect(unknownDelivery.warnings).toContain(
      "Shipping and mandatory fees not yet verified; confirm them before buying",
    );
    expect(
      evaluateVehicle(listing({ mandatory_fees: null }), profile).eligibility,
    ).toBe("eligible");
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
  it("scopes seller cost confirmations while battery follows the VIN", () => {
    const row = listing({
      shipping: null,
      mandatory_fees: null,
      delivery: "unknown",
    });
    const overrides = {
      attributes: {
        battery_pack: "max",
        motor: null,
        battery_evidence: "verified",
      },
      listing_verifications: {
        [listingVerificationKey(row)]: {
          source: row.source,
          source_listing_id: row.source_listing_id,
          seller: row.seller,
          seller_id: row.seller_id,
          url: row.url,
          shipping: 0,
          mandatory_fees: 0,
          delivery: "pickup" as const,
        },
      },
    };
    expect(
      evaluateVehicle(applyVehicleOverrides(row, overrides, profile), profile)
        .eligibility,
    ).toBe("eligible");
    for (const changed of [
      { seller: "Different Dealer" },
      { seller_id: "new-id" },
      { url: "https://example.com/new-listing" },
      { source_listing_id: "another-listing" },
      { source: "manual" as const },
    ]) {
      const verified = applyVehicleOverrides(
        { ...row, ...changed },
        overrides,
        profile,
      );
      expect(verified.attributes.battery_pack).toBe("max");
      const evaluation = evaluateVehicle(verified, profile);
      expect(evaluation.eligibility).toBe("eligible");
      expect(evaluation.effective_cost).toBeNull();
    }
  });
  it("uses the edited price over the feed price only for the same listing", () => {
    const row = listing({ price: null });
    const overrides = {
      listing_verifications: {
        [listingVerificationKey(row)]: {
          source: row.source,
          source_listing_id: row.source_listing_id,
          seller: row.seller,
          seller_id: row.seller_id,
          url: row.url,
          price: 51000,
          interior_photo: "https://example.com/cabin.jpg",
        },
      },
    };
    expect(applyVehicleOverrides(row, overrides, profile).price).toBe(51000);
    const cleared = structuredClone(overrides);
    const key = listingVerificationKey(row);
    const clearedOverrides = {
      listing_verifications: {
        [key]: { ...cleared.listing_verifications[key], price: null },
      },
    };
    expect(
      applyVehicleOverrides({ ...row, price: 49000 }, clearedOverrides, profile)
        .price,
    ).toBe(49000);
    expect(
      evaluateVehicle(
        applyVehicleOverrides(
          { ...row, price: 49000, shipping: 1000, mandatory_fees: 200 },
          overrides,
          profile,
        ),
        profile,
      ).effective_cost,
    ).toBe(51200);

    expect(
      applyVehicleOverrides({ ...row, price: 49000 }, overrides, profile).price,
    ).toBe(51000);
    expect(
      applyVehicleOverrides(
        { ...row, seller: "Different Dealer" },
        overrides,
        profile,
      ).price,
    ).toBeNull();
    expect(
      applyVehicleOverrides(row, overrides, profile).photos,
    ).toContainEqual({
      url: "https://example.com/cabin.jpg",
      category: "interior",
    });
    expect(
      applyVehicleOverrides(
        { ...row, seller: "Different Dealer" },
        overrides,
        profile,
      ).photos,
    ).toEqual(row.photos);
  });
  it("ignores legacy unscoped listing costs and identity overrides", () => {
    const row = listing({
      shipping: null,
      mandatory_fees: null,
      delivery: "unknown",
    });
    const legacy = {
      shipping: 0,
      mandatory_fees: 0,
      delivery: "pickup",
      vin: "7FCTGAAA0NN000099",
      title_status: "clean",
    };
    const verified = applyVehicleOverrides(row, legacy, profile);
    expect(verified.vin).toBe(row.vin);
    expect(evaluateVehicle(verified, profile).eligibility).toBe("eligible");
  });
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
  it("uses durable evidence for missing fields, with owner confirmations taking priority", () => {
    const r = record({
      enrichment: {
        status: "resolved",
        attributes: {
          battery_pack: "max",
          motor: "quad",
          battery_evidence: "Seller page: Max Pack",
        },
      },
    });
    r.vehicle_listings[0].data.attributes = {
      battery_pack: null,
      motor: null,
      battery_evidence: null,
    };
    // Saving an unrelated manual correction with unknown configuration does not
    // suppress later seller evidence.
    r.overrides.attributes = {
      battery_pack: null,
      motor: null,
      battery_evidence: null,
    };
    let reviewed = reviewVehicle(r, profile)!;
    expect(reviewed.row.attributes).toEqual({
      battery_pack: "max",
      motor: "quad",
      battery_evidence: "Seller page: Max Pack",
    });
    expect(reviewed.evaluation.eligibility).toBe("eligible");
    r.overrides.attributes = {
      battery_pack: "large",
      motor: "dual",
      battery_evidence: "Owner confirmed",
    };
    reviewed = reviewVehicle(r, profile)!;
    expect(reviewed.row.attributes).toEqual(r.overrides.attributes);
    expect(reviewed.decision).toBe(r.decision);
  });
  it("fills unknown fields from exact-VIN NHTSA evidence without replacing known values or inferring a pack", () => {
    const r = record();
    r.vehicle_listings[0].data.attributes = {
      motor: null,
      battery_pack: null,
      battery_evidence: null,
    };
    r.nhtsa = {
      vin: r.vin!,
      status: "decoded",
      checked_at: new Date().toISOString(),
      source_url: "https://vpic.nhtsa.dot.gov/api/",
      identity: { year: "2022", make: "RIVIAN", model: "R1T", trim: "" },
      attributes: {
        motor: "quad",
        motor_evidence: "NHTSA EVDriveUnit: Quad Motor",
      },
      battery_kwh: 128.9,
      battery_kwh_to: null,
      battery_type: null,
      battery_info: null,
    };
    expect(reviewVehicle(r, profile)!.row.attributes).toMatchObject({
      motor: "quad",
      battery_pack: null,
    });
    r.overrides.attributes = {
      motor: "dual",
      battery_pack: "max",
      battery_evidence: "Owner confirmed",
    };
    expect(reviewVehicle(r, profile)!.row.attributes).toEqual(
      r.overrides.attributes,
    );
    r.overrides = {};
    r.vehicle_listings[0].data.attributes.motor = "dual";
    expect(reviewVehicle(r, profile)!.row.attributes.motor).toBe("dual");
    r.vehicle_listings[0].data.attributes.motor = null;
    r.nhtsa.vin = "7FCTGAAA0NN000099";
    expect(reviewVehicle(r, profile)!.row.attributes.motor).toBeNull();
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
