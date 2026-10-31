import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { requireWorker } from "@/lib/worker-auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    const { supabase, worker } = await requireWorker(request);
    const { data: run, error } = await supabase
      .from("runs")
      .update({ agent_heartbeat_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("worker_id", worker.id)
      .eq("job_kind", "agent")
      .eq("status", "working")
      .select("id")
      .maybeSingle();
    if (error || !run)
      throw new ApiError("Active agent run not found for this worker.", 404);
    return NextResponse.json({ heartbeat: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
