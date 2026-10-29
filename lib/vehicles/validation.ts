import { ApiError } from "@/lib/api-error";
import { defaultVehicleProfile } from "./domain";
import type { VehicleListing, VehicleProfile } from "./types";

const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new ApiError("Expected an object.");
  return v as Record<string, unknown>;
};
const str = (v: unknown, max = 500) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const number = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100000000
    ? v
    : null;
const coordinates = (v: unknown): [number, number] | null =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every((n) => typeof n === "number" && Number.isFinite(n)) &&
  Math.abs(v[0]) <= 180 &&
  Math.abs(v[1]) <= 90
    ? [v[0], v[1]]
    : null;
export function safeVehicleUrl(value: unknown) {
  try {
    const url = new URL(str(value, 2000));
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function parseVehicleProfile(value: unknown): VehicleProfile {
  const v = object(value);
  const make = str(v.make, 80),
    model = str(v.model, 80),
    origin = str(v.origin_zip, 10);
  if (
    !make ||
    !model ||
    !/^\d{5}$/.test(origin) ||
    !number(v.cost_ceiling) ||
    !number(v.local_miles) ||
    number(v.preferred_miles) === null ||
    !number(v.high_miles) ||
    Number(v.high_miles) <= Number(v.preferred_miles)
  )
    throw new ApiError(
      "Choose a make, model, ZIP, positive cost/distance, and valid mileage range.",
    );
  if (
    !Array.isArray(v.allowed_batteries) ||
    v.allowed_batteries.length > 20 ||
    !v.allowed_batteries.every(
      (s) => typeof s === "string" && s.length > 0 && s.length <= 60,
    )
  )
    throw new ApiError("Invalid battery requirements.");
  const weights = object(v.weights ?? defaultVehicleProfile.weights);
  if (
    !Object.keys(defaultVehicleProfile.weights).every(
      (key) => number(weights[key]) !== null,
    ) ||
    Object.values(weights).reduce<number>((a, b) => a + Number(b), 0) !== 100
  )
    throw new ApiError("Score weights must total 100.");
  return {
    make,
    model,
    origin_zip: origin,
    origin_coordinates: coordinates(v.origin_coordinates),
    cost_ceiling: Number(v.cost_ceiling),
    local_miles: Number(v.local_miles),
    preferred_miles: Number(v.preferred_miles),
    high_miles: Number(v.high_miles),
    allowed_batteries: v.allowed_batteries.map((s) => String(s).toLowerCase()),
    excluded_titles: Array.isArray(v.excluded_titles)
      ? v.excluded_titles
          .slice(0, 30)
          .map((s) => str(s, 80).toLowerCase())
          .filter(Boolean)
      : defaultVehicleProfile.excluded_titles,
    weights: weights as VehicleProfile["weights"],
  };
}

export function parseVehicleListing(
  value: unknown,
  source: "auto.dev" | "manual" = "auto.dev",
): VehicleListing {
  const v = object(value),
    attr = object(v.attributes ?? {});
  const vin = str(v.vin, 100).toUpperCase() || null;
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))
    throw new ApiError("VIN must contain 17 valid characters.");
  if (source === "auto.dev" && !vin)
    throw new ApiError("Auto.dev listings require a VIN.");
  const make = str(v.make, 80),
    model = str(v.model, 80);
  const id = str(v.source_listing_id, 200);
  if (!make || !model || !id)
    throw new ApiError("Listing identity, make and model are required.");
  const photos = Array.isArray(v.photos)
    ? v.photos.slice(0, 50).flatMap((item) => {
        const photo = object(item),
          url = safeVehicleUrl(photo.url);
        return url
          ? [
              {
                url,
                category: ["exterior", "interior"].includes(str(photo.category))
                  ? (photo.category as "exterior" | "interior")
                  : ("unknown" as const),
              },
            ]
          : [];
      })
    : [];
  return {
    source,
    source_listing_id: id,
    vin,
    make,
    model,
    year:
      Number.isInteger(v.year) &&
      Number(v.year) >= 1980 &&
      Number(v.year) <= 2100
        ? Number(v.year)
        : null,
    trim: str(v.trim, 200),
    attributes: {
      battery_pack: str(attr.battery_pack, 60).toLowerCase() || null,
      motor: str(attr.motor, 60) || null,
      battery_evidence: str(attr.battery_evidence, 1500) || null,
    },
    raw_series: str(v.raw_series, 1000),
    price: number(v.price) && Number(v.price) > 0 ? Number(v.price) : null,
    mileage: number(v.mileage),
    seller: str(v.seller, 200),
    seller_id: str(v.seller_id, 200),
    url: safeVehicleUrl(v.url),
    city: str(v.city, 120),
    state: str(v.state, 30),
    zip: /^\d{5}$/.test(str(v.zip)) ? str(v.zip) : null,
    coordinates: coordinates(v.coordinates),
    condition: str(v.condition, 80),
    shipping: number(v.shipping),
    mandatory_fees: number(v.mandatory_fees),
    delivery:
      v.delivery === "pickup" || v.delivery === "confirmed"
        ? v.delivery
        : "unknown",
    title_status: str(v.title_status, 80).toLowerCase() || "unknown",
    history_available: v.history_available === true,
    history_flags: Array.isArray(v.history_flags)
      ? v.history_flags.slice(0, 20).map((s) => str(s, 100))
      : [],
    photos,
    photo_count: Math.min(number(v.photo_count) ?? photos.length, 100),
    source_created_at: str(v.source_created_at, 80) || null,
    source_updated_at: str(v.source_updated_at, 80) || null,
    availability:
      v.availability === "unavailable" ? "unavailable" : "available",
  };
}

export function parseVehicleHealth(value: unknown) {
  const v = object(value),
    c = object(v.counts),
    scope = object(v.scope);
  if (
    v.version !== 1 ||
    v.source !== "auto.dev" ||
    !["success", "partial", "blocked", "failed"].includes(String(v.status))
  )
    throw new ApiError("Unsupported collector result.");
  const counts = Object.fromEntries(
    [
      "reported",
      "pages",
      "requests",
      "discovered",
      "parsed",
      "invalid",
      "duplicates",
    ].map((key) => {
      const n = number(c[key]);
      if (key !== "reported" && (n === null || !Number.isInteger(n)))
        throw new ApiError("Invalid collector counts.");
      return [key, n];
    }),
  );
  for (const key of ["detail_attempted", "detail_resolved", "detail_failed"]) {
    const n = number(c[key]);
    if (n !== null && Number.isInteger(n)) counts[key] = n;
  }
  return {
    version: 1,
    source: "auto.dev",
    status: String(v.status),
    scope: {
      make: str(scope.make, 80),
      model: str(scope.model, 80),
      geography: "nationwide",
      origin_zip: str(scope.origin_zip, 5),
    },
    counts,
    warnings: Array.isArray(v.warnings)
      ? v.warnings.slice(0, 50).map((s) => str(s, 100))
      : [],
    started_at: str(v.started_at, 80),
    finished_at: str(v.finished_at, 80),
  };
}
