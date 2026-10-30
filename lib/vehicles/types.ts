export type Decision = "unreviewed" | "passed" | "watch" | "shortlist";
export type Eligibility = "eligible" | "ineligible" | "needs_verification";
export type VehicleProfile = {
  make: string;
  model: string;
  origin_zip: string;
  origin_coordinates: [number, number] | null;
  local_miles: number;
  cost_ceiling: number;
  allowed_batteries: string[];
  preferred_miles: number;
  high_miles: number;
  excluded_titles: string[];
  weights: {
    price: number;
    mileage: number;
    distance: number;
    history: number;
    configuration: number;
    seller: number;
  };
};
export type VehicleListing = {
  source: "auto.dev" | "manual";
  source_listing_id: string;
  vin: string | null;
  year: number | null;
  make: string;
  model: string;
  trim: string;
  attributes: {
    battery_pack: string | null;
    motor: string | null;
    battery_evidence: string | null;
  };
  raw_series: string;
  price: number | null;
  mileage: number | null;
  seller: string;
  seller_id: string;
  url: string | null;
  city: string;
  state: string;
  zip: string | null;
  coordinates: [number, number] | null;
  condition: string;
  shipping: number | null;
  mandatory_fees: number | null;
  delivery: "unknown" | "confirmed" | "pickup";
  title_status: string;
  history_available: boolean;
  history_flags: string[];
  photos: { url: string; category: "exterior" | "interior" | "unknown" }[];
  photo_count: number;
  gallery_fetched_at: string | null;
  source_created_at: string | null;
  source_updated_at: string | null;
  availability: "available" | "unavailable";
};
export type VehicleRecord = {
  id: string;
  vin: string | null;
  decision: Decision;
  decision_revision: number;
  overrides: VehicleOverrides;
  first_seen_at: string;
  last_seen_at: string;
  vehicle_listings: {
    id: string;
    data: VehicleListing;
    photo_gallery?: VehicleListing["photos"];
    gallery_fetched_at?: string | null;
    last_seen_at: string;
    availability: string;
  }[];
};
export type ListingVerification = Pick<
  VehicleListing,
  "source" | "source_listing_id" | "seller" | "seller_id" | "url"
> &
  Partial<
    Pick<VehicleListing, "price" | "shipping" | "mandatory_fees" | "delivery">
  > & {
    interior_photo?: string;
  };
export type VehicleOverrides = Partial<
  Pick<
    VehicleListing,
    "attributes" | "title_status" | "history_available" | "history_flags"
  >
> & {
  listing_verifications?: Record<string, ListingVerification>;
};
export type Evaluation = {
  eligibility: Eligibility;
  reasons: string[];
  warnings: string[];
  score: number;
  breakdown: Record<string, number>;
  effective_cost: number | null;
  distance_miles: number | null;
  delivery_group: string;
};
