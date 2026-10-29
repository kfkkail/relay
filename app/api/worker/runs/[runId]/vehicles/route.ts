import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { requireWorker } from "@/lib/worker-auth";
import { evaluateVehicle } from "@/lib/vehicles/domain";
import {
  parseVehicleHealth,
  parseVehicleListing,
  parseVehicleProfile,
} from "@/lib/vehicles/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { supabase, worker } = await requireWorker(request);
    const { runId } = await params;
    // Read a bounded stream; a missing/forged Content-Length must not bypass
    // ingestion limits. Unknown worker fields never reach storage.
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError("Vehicle result required.");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 1024 * 1024)
          throw new ApiError("Vehicle batch exceeds 1 MB.", 413);
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const { data: run, error } = await supabase
      .from("runs")
      .select("id,job_kind,job_payload,status,user_id")
      .eq("id", runId)
      .eq("worker_id", worker.id)
      .eq("vehicle_lease", body.lease)
      .eq("user_id", worker.user_id)
      .maybeSingle();
    if (error || !run || run.job_kind !== "vehicle_search")
      throw new ApiError("Vehicle run not found.", 404);
    if (body.action === "heartbeat") {
      const { error: heartbeatError } = await supabase
        .from("runs")
        .update({ vehicle_heartbeat_at: new Date().toISOString() })
        .eq("id", runId)
        .eq("worker_id", worker.id)
        .eq("vehicle_lease", body.lease)
        .eq("status", "working");
      if (heartbeatError) throw heartbeatError;
      return NextResponse.json({ alive: true });
    }
    let result;
    if (body.action === "batch") {
      if (
        !Number.isInteger(body.batch) ||
        body.batch < 0 ||
        body.batch >= 100 ||
        !Array.isArray(body.listings) ||
        body.listings.length > 100
      )
        throw new ApiError("Invalid vehicle batch.");
      const { data: revision, error: revisionError } = await supabase
        .from("vehicle_profile_versions")
        .select("config")
        .eq("profile_id", run.job_payload.profile_id)
        .eq("version", run.job_payload.profile_version)
        .eq("user_id", worker.user_id)
        .single();
      if (revisionError || !revision)
        throw new ApiError("Profile revision missing.", 409);
      const profile = parseVehicleProfile(revision.config);
      const normalized = body.listings.map((value: unknown) => parseVehicleListing(value));
      const { data: verified, error: verifiedError } = await supabase.from("vehicles").select("vin,overrides").eq("user_id", worker.user_id).in("vin", normalized.map((row) => row.vin).filter(Boolean));
      if (verifiedError) throw verifiedError;
      const overrides = new Map((verified ?? []).map((v) => [v.vin, v.overrides]));
      const listings = normalized.map((row) => {
        const owner = overrides.get(row.vin) ?? {};
        return {
          ...row,
          eligibility: evaluateVehicle({ ...row, ...owner, attributes: { ...row.attributes, ...owner.attributes } }, profile).eligibility,
        };
      });
      result = await supabase.rpc("stage_vehicle_batch", {
        p_run: runId,
        p_worker: worker.id,
        p_lease: body.lease,
        p_batch: body.batch,
        p_listings: listings,
      });
    } else if (body.action === "photos") {
      const row = parseVehicleListing({
        vin: run.job_payload.photo_vin,
        source_listing_id: run.job_payload.photo_vin,
        make: "photo",
        model: "photo",
        photos: body.photos,
      });
      result = await supabase.rpc("complete_vehicle_photos", {
        p_run: runId,
        p_worker: worker.id,
        p_lease: body.lease,
        p_photos: row.photos,
      });
    } else if (body.action === "finalize") {
      result = await supabase.rpc("finalize_vehicle_run", {
        p_run: runId,
        p_worker: worker.id,
        p_lease: body.lease,
        p_health: parseVehicleHealth(body.health),
      });
    } else throw new ApiError("Unknown vehicle result action.");
    if (result.error)
      throw new ApiError(
        "Vehicle ingestion could not commit; the run can be retried.",
        409,
      );
    return NextResponse.json({ result: result.data });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
