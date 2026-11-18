import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { requireWorker } from "@/lib/worker-auth";
import { backfillNhtsa } from "@/lib/vehicles/nhtsa-backfill";
import { readVehicleJson } from "@/lib/vehicles/request";

export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const { supabase, worker } = await requireWorker(request);
    const { cursor = null } = await readVehicleJson(request, 1000);
    if (
      cursor !== null &&
      (typeof cursor !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          cursor,
        ))
    )
      throw new ApiError("Invalid vehicle cursor.");
    return NextResponse.json(
      await backfillNhtsa(supabase, worker.user_id, cursor),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
