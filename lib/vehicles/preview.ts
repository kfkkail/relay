import { defaultVehicleProfile, listingVerificationKey } from "./domain";
import { parseVehicleListing, parseVehicleProfile } from "./validation";
import type { Decision, VehicleRecord } from "./types";
import type { VehicleRequest } from "@/components/vehicles";

// In-memory illustrative data only. This transport never calls fetch, Supabase
// or a worker; each browser mount gets a fresh, independent review session.
export function createVehiclePreviewRequest(): VehicleRequest {
  const profile = {
    id: "00000000-0000-4000-8000-000000000011",
    version: 1,
    config: structuredClone(defaultVehicleProfile),
    schedule_id: "00000000-0000-4000-8000-000000000012",
    task_schedules: {
      enabled: false,
      next_due_at: null,
      timezone: "America/Indiana/Indianapolis",
      start_minute: 420,
    },
  };
  const examples = [
    {
      price: 52900,
      mileage: 24300,
      city: "South Bend",
      state: "IN",
      seller: "Example Auto Group",
      battery: "large",
      decision: "unreviewed",
      coordinates: [-86.25, 41.67],
    },
    {
      price: 56800,
      mileage: 18500,
      city: "Chicago",
      state: "IL",
      seller: "Example Electric Motors",
      battery: "max",
      decision: "unreviewed",
      coordinates: [-87.62, 41.88],
    },
    {
      price: 48750,
      mileage: 39200,
      city: "Indianapolis",
      state: "IN",
      seller: "Example Vehicle Center",
      battery: "large",
      decision: "watch",
      coordinates: [-86.16, 39.77],
    },
    {
      price: 49900,
      mileage: 31800,
      city: "Grand Rapids",
      state: "MI",
      seller: "Example Lakeshore Auto",
      battery: null,
      decision: "unreviewed",
      coordinates: [-85.67, 42.96],
    },
    {
      price: 58900,
      mileage: 15200,
      city: "Fort Wayne",
      state: "IN",
      seller: "Example Adventure Motors",
      battery: "max",
      decision: "shortlist",
      coordinates: [-85.14, 41.08],
    },
  ];
  const records: VehicleRecord[] = examples.map((example, i) => {
    const vin = `7FCTGAAA0NN00000${i + 1}`;
    const row = parseVehicleListing({
      source_listing_id: vin,
      vin,
      year: 2023,
      make: "Rivian",
      model: "R1T",
      trim: i % 2 ? "Launch Edition" : "Adventure",
      price: example.price,
      mileage: example.mileage,
      city: example.city,
      state: example.state,
      seller: example.seller,
      seller_id: `sample-${i}`,
      coordinates: example.coordinates,
      url: "https://example.com/illustrative-listing",
      condition: "used",
      attributes: {
        battery_pack: example.battery,
        motor: i % 2 ? "dual" : "quad",
        battery_evidence: example.battery
          ? "Illustrative seller confirmation"
          : null,
      },
      shipping: example.battery ? 0 : null,
      mandatory_fees: example.battery ? 250 : null,
      delivery: example.battery ? "pickup" : "unknown",
      title_status: "clean",
      history_available: true,
      history_flags: [],
      availability: "available",
      photos: [
        {
          url: `/vehicles-demo/${i % 2 ? "glacier-white" : "forest-green"}.jpg`,
          category: "exterior",
        },
        { url: "/vehicles-demo/interior.png", category: "interior" },
      ],
    });
    // Listing validation intentionally accepts only absolute source URLs. The
    // preview alone uses bundled, licensed example photography.
    row.photos = [
      {
        url: `/vehicles-demo/${i % 2 ? "glacier-white" : "forest-green"}.jpg`,
        category: "exterior",
      },
      { url: "/vehicles-demo/interior.png", category: "interior" },
    ];
    return {
      id: `00000000-0000-4000-8000-00000000002${i}`,
      vin,
      decision: example.decision as Decision,
      decision_revision: 0,
      overrides: {},
      first_seen_at: "2026-10-29T09:00:00Z",
      last_seen_at: "2026-10-29T09:00:00Z",
      vehicle_listings: [
        {
          id: `sample-listing-${i}`,
          data: row,
          availability: "available",
          last_seen_at: "2026-10-29T09:00:00Z",
        },
      ],
    };
  });
  return async (path, init) => {
    if (!path.startsWith("/api/vehicles"))
      return Response.json({ error: "Sample endpoint only." }, { status: 404 });
    if (!init?.method || init.method === "GET")
      return Response.json({
        profiles: [profile],
        vehicles: records,
        total: records.length,
        pending: [],
        runs: [
          {
            run_id: "sample-run",
            status: "partial",
            finished_at: "2026-10-29T09:00:00Z",
            health: {
              counts: { reported: 547, parsed: 544, pages: 28 },
              warnings: ["Sample coverage warning: count mismatch"],
            },
            summary: {},
          },
        ],
      });
    try {
      const body = JSON.parse(String(init.body));
      const record = records.find((item) => item.id === body.id);
      if (body.action === "decision" && record) {
        if (record.decision_revision !== body.revision)
          throw new Error("Sample vehicle changed; refresh first.");
        if (
          !["unreviewed", "passed", "watch", "shortlist"].includes(
            body.decision,
          )
        )
          throw new Error("Invalid sample decision.");
        record.decision = body.decision;
        return Response.json({ result: ++record.decision_revision });
      }
      if (body.action === "profile") {
        profile.config = parseVehicleProfile(body.config);
        profile.version++;
        return Response.json({ result: profile.id });
      }
      if (body.action === "verify" && record) {
        const row = parseVehicleListing(body.listing, body.listing.source);
        const current = record.vehicle_listings.find(
          (listing) =>
            listing.data.source === row.source &&
            listing.data.source_listing_id === row.source_listing_id,
        )?.data;
        record.overrides = {
          ...record.overrides,
          attributes: row.attributes,
          title_status: row.title_status,
          history_available: row.history_available,
          history_flags: row.history_flags,
          listing_verifications: {
            ...record.overrides.listing_verifications,
            [listingVerificationKey(row)]: {
              source: row.source,
              source_listing_id: row.source_listing_id,
              seller: row.seller,
              seller_id: row.seller_id,
              url: row.url,
              price: row.price === current?.price ? null : row.price,
              shipping: row.shipping,
              mandatory_fees: row.mandatory_fees,
              delivery: row.delivery,
            },
          },
        };
        return Response.json({ result: null });
      }
      if (body.action === "interior_photo" && record) {
        const row = record.vehicle_listings.find(
          (item) =>
            item.data.source_listing_id === body.listing.source_listing_id,
        )?.data;
        if (!row || !row.photos.some((photo) => photo.url === body.photoUrl))
          throw new Error("Sample photo not found.");
        const key = listingVerificationKey(row);
        record.overrides.listing_verifications = {
          ...record.overrides.listing_verifications,
          [key]: {
            ...record.overrides.listing_verifications?.[key],
            source: row.source,
            source_listing_id: row.source_listing_id,
            seller: row.seller,
            seller_id: row.seller_id,
            url: row.url,
            interior_photo: body.photoUrl,
          },
        };
        return Response.json({ result: null });
      }
      throw new Error(
        "This sample does not create searches, schedules or live inventory. Review decisions, photos, verification and profile edits are interactive.",
      );
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error ? error.message : "Invalid sample action.",
        },
        { status: 409 },
      );
    }
  };
}
