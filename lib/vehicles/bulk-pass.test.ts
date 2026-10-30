import { describe, expect, it } from "vitest";
import { defaultVehicleProfile } from "./domain";
import { findBulkPassCandidates } from "./bulk-pass";
import type { VehicleRecord } from "./types";

const record = (overrides: Partial<VehicleRecord> = {}): VehicleRecord => ({
  id: "00000000-0000-4000-8000-000000000001",
  vin: "7FCTGAAA0NN000001",
  decision: "unreviewed",
  decision_revision: 2,
  overrides: {},
  first_seen_at: "2026-10-30T00:00:00Z",
  last_seen_at: "2026-10-30T00:00:00Z",
  vehicle_listings: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      last_seen_at: "2026-10-30T00:00:00Z",
      availability: "available",
      data: {
        source: "auto.dev",
        source_listing_id: "7FCTGAAA0NN000001",
        vin: "7FCTGAAA0NN000001",
        year: 2022,
        make: "Rivian",
        model: "R1T",
        trim: "Adventure",
        attributes: {
          battery_pack: null,
          motor: null,
          battery_evidence: null,
        },
        raw_series: "",
        price: 56000,
        mileage: 50000,
        seller: "Far Away Motors",
        seller_id: "far-away",
        url: "https://example.com/listing",
        city: "Los Angeles",
        state: "CA",
        zip: "90001",
        coordinates: [-118.24, 34.05],
        condition: "used",
        shipping: null,
        mandatory_fees: null,
        delivery: "unknown",
        title_status: "unknown",
        history_available: false,
        history_flags: [],
        photos: [],
        photo_count: 0,
        gallery_fetched_at: null,
        source_created_at: null,
        source_updated_at: null,
        availability: "available",
      },
    },
  ],
  ...overrides,
});

describe("findBulkPassCandidates", () => {
  it("selects an unreviewed, distant needs-verification vehicle below the score cutoff", () => {
    const candidates = findBulkPassCandidates(
      [record()],
      defaultVehicleProfile,
      { maxScore: 100, minDistanceMiles: 500 },
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      revision: 2,
      distance_miles: expect.any(Number),
    });
  });

  it("does not select passed, nearby, or over-cutoff vehicles", () => {
    expect(
      findBulkPassCandidates(
        [record({ decision: "passed" })],
        defaultVehicleProfile,
        { maxScore: 100, minDistanceMiles: 500 },
      ),
    ).toEqual([]);
    expect(
      findBulkPassCandidates([record()], defaultVehicleProfile, {
        maxScore: 0,
        minDistanceMiles: 500,
      }),
    ).toEqual([]);
    expect(
      findBulkPassCandidates([record()], defaultVehicleProfile, {
        maxScore: 100,
        minDistanceMiles: 5000,
      }),
    ).toEqual([]);
  });
});
