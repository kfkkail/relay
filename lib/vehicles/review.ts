import { applyVehicleOverrides, evaluateVehicle } from "./domain";
import type { VehicleListing, VehicleProfile, VehicleRecord } from "./types";

export function reviewVehicle(record: VehicleRecord, profile: VehicleProfile) {
  const listings = record.vehicle_listings
    .map((listing) => {
      const row: VehicleListing = {
        ...applyVehicleOverrides(listing.data, record.overrides, profile),
        vin: record.vin,
        availability: listing.availability as VehicleListing["availability"],
      };
      return { row, evaluation: evaluateVehicle(row, profile) };
    })
    .sort((a, b) => {
      const priority = { eligible: 0, needs_verification: 1, ineligible: 2 };
      return (
        priority[a.evaluation.eligibility] -
          priority[b.evaluation.eligibility] ||
        b.evaluation.score - a.evaluation.score
      );
    });
  return listings[0]
    ? { ...record, ...listings[0], sources: listings.map((item) => item.row) }
    : null;
}

export function inVehicleQueue(
  vehicle: NonNullable<ReturnType<typeof reviewVehicle>>,
  queue: string,
) {
  if (queue === "passed") return vehicle.decision === "passed";
  if (vehicle.decision === "passed") return false;
  if (queue === "watch" || queue === "shortlist")
    return vehicle.decision === queue;
  if (vehicle.decision !== "unreviewed") return false;
  if (!["unreviewed", "verification"].includes(queue)) return false;
  return queue === "verification"
    ? vehicle.evaluation.eligibility === "needs_verification"
    : vehicle.evaluation.eligibility === "eligible";
}
