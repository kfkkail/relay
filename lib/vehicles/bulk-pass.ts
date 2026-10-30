import { reviewVehicle } from "./review";
import type { VehicleProfile, VehicleRecord } from "./types";

export type BulkPassCandidate = {
  id: string;
  revision: number;
  score: number;
  distance_miles: number;
  year: number | null;
  price: number | null;
  mileage: number | null;
  location: string;
  seller: string;
  url: string | null;
};

export function findBulkPassCandidates(
  records: VehicleRecord[],
  profile: VehicleProfile,
  options: { maxScore: number; minDistanceMiles: number },
): BulkPassCandidate[] {
  return records.flatMap((record) => {
    if (record.decision !== "unreviewed") return [];
    const vehicle = reviewVehicle(record, profile);
    if (
      !vehicle ||
      vehicle.evaluation.eligibility !== "needs_verification" ||
      vehicle.evaluation.score > options.maxScore ||
      vehicle.evaluation.distance_miles === null ||
      vehicle.evaluation.distance_miles < options.minDistanceMiles
    )
      return [];
    return [
      {
        id: vehicle.id,
        revision: vehicle.decision_revision,
        score: vehicle.evaluation.score,
        distance_miles: vehicle.evaluation.distance_miles,
        year: vehicle.row.year,
        price: vehicle.row.price,
        mileage: vehicle.row.mileage,
        location: [vehicle.row.city, vehicle.row.state]
          .filter(Boolean)
          .join(", "),
        seller: vehicle.row.seller,
        url: vehicle.row.url,
      },
    ];
  });
}
