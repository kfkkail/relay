import { afterEach, describe, expect, it, vi } from "vitest";
import { createVehiclePreviewRequest } from "./preview";
import { defaultVehicleProfile } from "./domain";
import { inVehicleQueue, reviewVehicle } from "./review";
import type { VehicleRecord } from "./types";

afterEach(() => vi.restoreAllMocks());

describe("isolated Vehicles preview", () => {
  it("renders sample states and never calls a live endpoint", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("No network allowed"));
    const request = createVehiclePreviewRequest();
    const body = await (await request("/api/vehicles?page=0")).json();
    expect(body.vehicles).toHaveLength(5);
    const reviewed = body.vehicles.map((record: VehicleRecord) =>
      reviewVehicle(record, defaultVehicleProfile),
    );
    expect(
      reviewed.filter((record: NonNullable<ReturnType<typeof reviewVehicle>>) =>
        inVehicleQueue(record, "unreviewed"),
      ),
    ).toHaveLength(2);
    expect(
      reviewed.filter((record: NonNullable<ReturnType<typeof reviewVehicle>>) =>
        inVehicleQueue(record, "verification"),
      ),
    ).toHaveLength(1);
    for (const action of ["run", "schedule", "photos", "manual", "vin"]) {
      expect(
        (
          await request("/api/vehicles", {
            method: "POST",
            body: JSON.stringify({ action }),
          })
        ).status,
      ).toBe(409);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps revision-safe review decisions within one sample session", async () => {
    const request = createVehiclePreviewRequest();
    const first = (await (await request("/api/vehicles")).json()).vehicles[0];
    const decide = (revision: number) =>
      request("/api/vehicles", {
        method: "POST",
        body: JSON.stringify({
          action: "decision",
          id: first.id,
          revision,
          decision: "passed",
        }),
      });
    expect((await decide(0)).status).toBe(200);
    expect((await decide(0)).status).toBe(409);
    const updated = (await (await request("/api/vehicles")).json()).vehicles[0];
    expect(updated.decision).toBe("passed");
    const changed = { ...defaultVehicleProfile, cost_ceiling: 100000 };
    expect(inVehicleQueue(reviewVehicle(updated, changed)!, "unreviewed")).toBe(
      false,
    );
    const independent = (
      await (await createVehiclePreviewRequest()("/api/vehicles")).json()
    ).vehicles[0];
    expect(independent.decision).toBe("unreviewed");
  });
  it("keeps photo selection separate from verified costs", async () => {
    const request = createVehiclePreviewRequest();
    const record = (await (await request("/api/vehicles")).json()).vehicles[0];
    const listing = record.vehicle_listings[0].data;
    const post = (body: object) =>
      request("/api/vehicles", {
        method: "POST",
        body: JSON.stringify({ id: record.id, ...body }),
      });
    expect(
      (
        await post({
          action: "verify",
          listing: {
            ...listing,
            shipping: 900,
            mandatory_fees: 400,
            delivery: "confirmed",
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post({
          action: "interior_photo",
          listing,
          photoUrl: listing.photos[1].url,
        })
      ).status,
    ).toBe(200);
    const updated = (await (await request("/api/vehicles")).json()).vehicles[0];
    const reviewed = reviewVehicle(updated, defaultVehicleProfile)!;
    expect(reviewed.evaluation.effective_cost).toBe(54200);
    expect(
      reviewed.row.photos.some((photo) => photo.category === "interior"),
    ).toBe(true);
  });
});
