import type {
  Evaluation,
  VehicleListing,
  VehicleOverrides,
  VehicleProfile,
} from "./types";

export const listingVerificationKey = (row: VehicleListing) =>
  `${row.source}:${row.source_listing_id}`;

export function sameListingContext(
  a: VehicleListing,
  b: Pick<
    VehicleListing,
    "source" | "source_listing_id" | "seller" | "seller_id" | "url"
  >,
) {
  return (
    ["source", "source_listing_id", "seller", "seller_id", "url"] as const
  ).every((key) => a[key] === b[key]);
}

export const defaultVehicleProfile: VehicleProfile = {
  make: "Rivian",
  model: "R1T",
  origin_zip: "46530",
  origin_coordinates: [-86.11, 41.75],
  local_miles: 150,
  cost_ceiling: 70000,
  allowed_batteries: ["large", "max"],
  preferred_miles: 40000,
  high_miles: 75000,
  excluded_titles: [
    "salvage",
    "rebuilt",
    "flood",
    "lemon-law buyback",
    "manufacturer buyback",
    "unresolved title problem",
  ],
  weights: {
    price: 30,
    mileage: 20,
    distance: 15,
    history: 15,
    configuration: 10,
    seller: 10,
  },
};

export function applyVehicleOverrides(
  row: VehicleListing,
  overrides: VehicleOverrides,
  profile: VehicleProfile,
): VehicleListing {
  // Only vehicle-level facts follow a VIN. Legacy unscoped costs/photos and
  // arbitrary identity fields must never leak onto another seller's listing.
  const verified: VehicleListing = {
    ...row,
    attributes: { ...row.attributes, ...overrides.attributes },
    title_status: overrides.title_status ?? row.title_status,
    history_available: overrides.history_available ?? row.history_available,
    history_flags: overrides.history_flags ?? row.history_flags,
  };
  const scoped = overrides.listing_verifications?.[listingVerificationKey(row)];
  if (scoped && sameListingContext(row, scoped)) {
    verified.price = scoped.price ?? row.price ?? null;
    verified.shipping =
      scoped.shipping === undefined ? row.shipping : scoped.shipping;
    verified.mandatory_fees =
      scoped.mandatory_fees === undefined
        ? row.mandatory_fees
        : scoped.mandatory_fees;
    verified.delivery = scoped.delivery ?? row.delivery;
    if (scoped.interior_photo) {
      verified.photos = row.photos
        .filter((photo) => photo.url !== scoped.interior_photo)
        .map((photo) => ({
          ...photo,
          category: photo.category === "interior" ? "unknown" : photo.category,
        }));
      verified.photos.push({
        url: scoped.interior_photo,
        category: "interior",
      });
    }
  }
  if (profile.excluded_titles.includes(row.title_status.toLowerCase()))
    verified.title_status = row.title_status;
  return verified;
}

export function distanceMiles(
  a: [number, number] | null,
  b: [number, number] | null,
) {
  if (!a || !b) return null;
  const radians = (v: number) => (v * Math.PI) / 180;
  const lat = radians(b[1] - a[1]);
  const lon = radians(b[0] - a[0]);
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(lon / 2) ** 2;
  return Math.round(3958.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h))));
}

export function evaluateVehicle(
  row: VehicleListing,
  profile: VehicleProfile,
): Evaluation {
  const reasons: string[] = [],
    warnings: string[] = [];
  let failed = false;
  const fail = (message: string) => {
    failed = true;
    reasons.push(message);
  };
  if (
    row.make.toLowerCase() !== profile.make.toLowerCase() ||
    row.model.toLowerCase() !== profile.model.toLowerCase()
  )
    fail("Make/model does not match");
  if (!row.vin)
    reasons.push("VIN unverified; cross-source suppression is uncertain");
  if (profile.allowed_batteries.length) {
    if (!row.attributes.battery_pack) reasons.push("Battery pack unverified");
    else if (!profile.allowed_batteries.includes(row.attributes.battery_pack))
      fail("Battery pack does not meet requirement");
  }
  if (profile.excluded_titles.includes(row.title_status.toLowerCase()))
    fail("Excluded title status");
  if (!row.history_available || row.title_status === "unknown")
    warnings.push("History unverified");
  warnings.push(...row.history_flags);
  const shipping = row.delivery === "pickup" ? 0 : row.shipping;
  const cost =
    row.price !== null && shipping !== null && row.mandatory_fees !== null
      ? row.price + shipping + row.mandatory_fees
      : null;
  if (row.price !== null && row.price > profile.cost_ceiling)
    fail("Advertised price exceeds cost ceiling");
  else if (cost !== null && cost > profile.cost_ceiling)
    fail("Effective cost exceeds ceiling");
  else if (cost === null)
    warnings.push(
      "Shipping and mandatory fees not yet verified; confirm them before buying",
    );
  if (row.availability === "unavailable") fail("Listing unavailable");
  const distance = distanceMiles(profile.origin_coordinates, row.coordinates);
  const group =
    distance !== null && distance <= profile.local_miles
      ? "Local"
      : row.delivery === "confirmed" && row.shipping !== null
        ? "Confirmed Delivery"
        : row.delivery === "pickup"
          ? "Pickup Required"
          : "Delivery Unknown";
  const w = profile.weights;
  // Advertised price is still useful for initial ranking. Unknown acquisition
  // costs lower confidence, but they no longer force every discovered vehicle
  // into the verification queue before the owner can review it.
  const rankingCost = cost ?? row.price;
  const mileage =
    row.mileage === null
      ? 0.2
      : row.mileage <= profile.preferred_miles
        ? 1
        : row.mileage <= profile.high_miles
          ? 1 -
            (0.65 * (row.mileage - profile.preferred_miles)) /
              Math.max(1, profile.high_miles - profile.preferred_miles)
          : Math.max(0, 0.35 - (row.mileage - profile.high_miles) / 100000);
  const breakdown = {
    price: Math.round(
      w.price *
        (rankingCost === null
          ? 0.3
          : Math.max(
              0,
              Math.min(1, 1.5 - rankingCost / profile.cost_ceiling),
            )) *
        (cost === null ? 0.8 : 1),
    ),
    mileage: Math.round(w.mileage * mileage),
    distance: Math.round(
      w.distance *
        (group === "Local"
          ? 1
          : group === "Confirmed Delivery"
            ? 0.8
            : distance === null
              ? 0.2
              : Math.max(0.1, 0.65 - distance / 5000)),
    ),
    history: Math.round(
      w.history *
        (row.history_available && row.title_status !== "unknown"
          ? Math.max(0.2, 1 - row.history_flags.length * 0.2)
          : 0.3),
    ),
    configuration: Math.round(
      w.configuration * (row.attributes.battery_pack ? 1 : 0.2),
    ),
    seller: Math.round(
      w.seller *
        (row.seller && row.url ? (row.source === "auto.dev" ? 0.8 : 0.6) : 0.2),
    ),
  };
  return {
    eligibility: failed
      ? "ineligible"
      : reasons.length
        ? "needs_verification"
        : "eligible",
    reasons,
    warnings,
    score: Object.values(breakdown).reduce((a, b) => a + b, 0),
    breakdown,
    effective_cost: cost,
    distance_miles: distance,
    delivery_group: group,
  };
}

export function materialVehicleChange(
  before: VehicleListing,
  after: VehicleListing,
  decision: string,
) {
  if (!["watch", "shortlist"].includes(decision)) return false;
  if (
    before.availability !== after.availability ||
    (!before.attributes.battery_pack && !!after.attributes.battery_pack) ||
    (before.shipping === null && after.shipping !== null) ||
    (before.mandatory_fees === null && after.mandatory_fees !== null)
  )
    return true;
  if (decision === "shortlist")
    return ["price", "seller", "url", "shipping", "mandatory_fees"].some(
      (key) =>
        before[key as keyof VehicleListing] !==
        after[key as keyof VehicleListing],
    );
  return (
    before.price !== null &&
    after.price !== null &&
    before.price - after.price >= Math.max(500, before.price * 0.01)
  );
}
