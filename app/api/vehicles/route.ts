import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";
import {
  defaultVehicleProfile,
  listingVerificationKey,
  sameListingContext,
} from "@/lib/vehicles/domain";
import {
  parseVehicleListing,
  parseVehicleProfile,
  safeVehicleUrl,
} from "@/lib/vehicles/validation";
import { readVehicleJson } from "@/lib/vehicles/request";

export const dynamic = "force-dynamic";
const uuid = (value: unknown) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

export async function GET(request: Request) {
  try {
    const { supabase } = await requireUser();
    const page = Math.max(
      0,
      Number(new URL(request.url).searchParams.get("page") || 0),
    );
    if (!Number.isInteger(page) || page > 99)
      throw new ApiError("Invalid page.");
    const [profiles, vehicles, runs, pending] = await Promise.all([
      supabase
        .from("vehicle_search_profiles")
        .select("*,task_schedules(enabled,next_due_at,timezone,start_minute)")
        .order("created_at")
        .limit(20),
      supabase
        .from("vehicles")
        .select(
          "*,vehicle_listings(id,data,photo_gallery,gallery_fetched_at,last_seen_at,availability)",
          { count: "exact" },
        )
        .order("first_seen_at", { ascending: false })
        .order("id")
        .range(page * 500, page * 500 + 499),
      supabase
        .from("vehicle_search_runs")
        .select("*")
        .order("finished_at", { ascending: false })
        .limit(20),
      supabase
        .from("runs")
        .select("id,status,queued_at,started_at,vehicle_heartbeat_at")
        .eq("job_kind", "vehicle_search")
        .in("status", ["queued", "working"])
        .order("queued_at")
        .limit(20),
    ]);
    if (profiles.error || vehicles.error || runs.error || pending.error)
      throw profiles.error || vehicles.error || runs.error || pending.error;
    return NextResponse.json(
      {
        profiles: profiles.data,
        vehicles: vehicles.data,
        total: vehicles.count,
        runs: runs.data,
        pending: pending.data,
        page,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase } = await requireUser();
    const body = await readVehicleJson(request, 100000);
    let result;
    switch (body.action) {
      case "profile":
        if (body.id != null && !uuid(body.id))
          throw new ApiError("Invalid profile.");
        result = await supabase.rpc("save_vehicle_profile", {
          p_id: body.id ?? null,
          p_config: parseVehicleProfile(body.config ?? defaultVehicleProfile),
        });
        break;
      case "decision":
        if (
          !uuid(body.id) ||
          !["unreviewed", "passed", "watch", "shortlist"].includes(
            body.decision,
          ) ||
          !Number.isInteger(body.revision) ||
          body.revision < 0
        )
          throw new ApiError("Invalid decision.");
        result = await supabase.rpc("set_vehicle_decision", {
          p_id: body.id,
          p_decision: body.decision,
          p_revision: body.revision,
        });
        break;
      case "verify":
      case "interior_photo": {
        if (!uuid(body.id)) throw new ApiError("Invalid vehicle.");
        if (!["auto.dev", "manual"].includes(body.listing?.source))
          throw new ApiError("Invalid listing source.");
        const row = parseVehicleListing(body.listing, body.listing.source);
        const { data: listing, error } = await supabase
          .from("vehicle_listings")
          .select("data,photo_gallery,gallery_fetched_at")
          .eq("vehicle_id", body.id)
          .eq("source", row.source)
          .eq("source_listing_id", row.source_listing_id)
          .single();
        if (error || !listing) throw new ApiError("Listing not found.", 404);
        const current = parseVehicleListing(
          {
            ...listing.data,
            photos: listing.photo_gallery?.length
              ? listing.photo_gallery
              : listing.data.photos,
            gallery_fetched_at: listing.gallery_fetched_at,
          },
          row.source,
        );
        if (!sameListingContext(current, row))
          throw new ApiError("Listing changed; refresh before verifying.", 409);
        const context = {
          source: current.source,
          source_listing_id: current.source_listing_id,
          seller: current.seller,
          seller_id: current.seller_id,
          url: current.url,
        };
        const interior = body.action === "interior_photo";
        if (interior && !current.photos.some((p) => p.url === body.photoUrl))
          throw new ApiError("Photo changed; reload the gallery.", 409);
        // The RPC rechecks the stored context transactionally. Gallery selection
        // only patches the photo, never stale battery/history/cost form values.
        result = await supabase.rpc("verify_vehicle", {
          p_id: body.id,
          p_overrides: {
            ...(!interior
              ? {
                  attributes: row.attributes,
                  title_status: row.title_status,
                  history_available: row.history_available,
                  history_flags: row.history_flags,
                }
              : {}),
            listing_verifications: {
              [listingVerificationKey(current)]: {
                ...context,
                ...(interior
                  ? { interior_photo: body.photoUrl }
                  : {
                      price: row.price === current.price ? null : row.price,
                      shipping: row.shipping,
                      mandatory_fees: row.mandatory_fees,
                      delivery: row.delivery,
                    }),
              },
            },
          },
        });
        break;
      }
      case "enrichment":
        if (!uuid(body.id) || !uuid(body.profileId))
          throw new ApiError("Invalid configuration request.");
        result = await supabase.rpc("request_vehicle_enrichment", {
          p_vehicle: body.id,
          p_profile: body.profileId,
        });
        break;
      case "photos":
        if (!uuid(body.id) || !uuid(body.profileId))
          throw new ApiError("Invalid gallery request.");
        result = await supabase.rpc("request_vehicle_photos", {
          p_vehicle: body.id,
          p_profile: body.profileId,
        });
        break;
      case "photos_batch": {
        const requestedIds = Array.isArray(body.ids) ? body.ids : [];
        const ids = [...new Set(requestedIds.filter(uuid))];
        if (
          !uuid(body.profileId) ||
          ids.length < 1 ||
          ids.length > 25 ||
          ids.length !== requestedIds.length
        )
          throw new ApiError("Invalid gallery batch.");
        result = await supabase.rpc("request_vehicle_photo_batch", {
          p_vehicles: ids,
          p_profile: body.profileId,
        });
        break;
      }
      case "vin":
        if (
          !uuid(body.id) ||
          typeof body.vin !== "string" ||
          !/^[A-HJ-NPR-Z0-9]{17}$/.test(body.vin)
        )
          throw new ApiError("Enter a valid VIN.");
        result = await supabase.rpc("confirm_vehicle_vin", {
          p_id: body.id,
          p_vin: body.vin,
        });
        break;
      case "run":
        if (!uuid(body.scheduleId) || !uuid(body.requestId))
          throw new ApiError("Invalid search request.");
        result = await supabase.rpc("run_task_schedule", {
          p_id: body.scheduleId,
          p_request: body.requestId,
        });
        if (!result.error && !result.data)
          throw new ApiError("A search is already queued or working.", 409);
        break;
      case "schedule": {
        if (!uuid(body.id) || typeof body.enabled !== "boolean")
          throw new ApiError("Invalid schedule.");
        const { data: profile } = await supabase
          .from("vehicle_search_profiles")
          .select("id,schedule_id")
          .eq("schedule_id", body.id)
          .single();
        if (!profile) throw new ApiError("Vehicle schedule not found.", 404);
        const { data: schedule } = await supabase
          .from("task_schedules")
          .select("*")
          .eq("id", body.id)
          .single();
        if (!schedule) throw new ApiError("Vehicle schedule not found.", 404);
        if (body.enabled) {
          const { data: baseline } = await supabase
            .from("vehicle_search_runs")
            .select("run_id")
            .eq("profile_id", profile.id)
            .eq("status", "success")
            .limit(1);
          if (!baseline?.length)
            throw new ApiError(
              "Complete and review a successful manual baseline before enabling daily searches.",
              409,
            );
        }
        result = await supabase.rpc("save_task_schedule", {
          p_id: body.id,
          p_config: { ...schedule, enabled: body.enabled },
        });
        break;
      }
      case "manual": {
        const url = safeVehicleUrl(body.listing?.url);
        if (!url) throw new ApiError("A valid listing URL is required.");
        const row = parseVehicleListing(
          {
            ...body.listing,
            source_listing_id:
              body.listing?.source_listing_id ||
              createHash("sha256").update(url).digest("hex"),
          },
          "manual",
        );
        result = await supabase.rpc("import_vehicle_listing", {
          p_listing: row,
        });
        break;
      }
      default:
        throw new ApiError("Unknown vehicle action.");
    }
    if (result.error) throw new ApiError(result.error.message, 409);
    return NextResponse.json({ result: result.data });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
