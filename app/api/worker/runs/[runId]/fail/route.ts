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
    const body = await request.json().catch(() => ({}));
    const message =
      typeof body.error === "string"
        ? body.error.slice(0, 20000)
        : "Worker run failed.";
    const { data: run, error: runError } = await supabase
      .from("runs")
      .select("id,task_id,user_id,attempt")
      .eq("id", runId)
      .eq("worker_id", worker.id)
      .eq("status", "working")
      .maybeSingle();
    if (runError || !run)
      throw new ApiError("Active run not found for this worker.", 404);

    const { data: stagedDocuments } = await supabase
      .from("result_documents")
      .select("storage_path")
      .eq("run_id", run.id)
      .eq("staged", true);
    const stagedPaths = (stagedDocuments ?? []).map(
      (item) => item.storage_path,
    );
    if (stagedPaths.length) {
      await supabase.storage.from("result-documents").remove(stagedPaths);
      await supabase
        .from("result_documents")
        .delete()
        .eq("run_id", run.id)
        .eq("staged", true);
    }

    await supabase
      .from("runs")
      .update({
        status: "failed",
        error: message,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    await supabase
      .from("tasks")
      .update({ status: "waiting" })
      .eq("id", run.task_id);
    await supabase.from("events").insert({
      task_id: run.task_id,
      run_id: run.id,
      user_id: run.user_id,
      type: "run.failed",
      payload: { attempt: run.attempt, error: message },
    });
    return NextResponse.json({ failed: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
