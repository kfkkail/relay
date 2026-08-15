import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const feedback = typeof body.feedback === "string" ? body.feedback.trim() : "";
    if (!feedback) throw new ApiError("Feedback is required.");

    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("id,status,runs(id,status,attempt)")
      .eq("id", taskId)
      .single();
    if (taskError || !task) throw new ApiError("Task not found.", 404);
    if (task.runs.some((run) => run.status === "queued" || run.status === "working")) {
      throw new ApiError("Wait for the active run to finish before trying again.", 409);
    }

    const attempt = Math.max(0, ...task.runs.map((run) => run.attempt)) + 1;
    const { data: run, error } = await supabase
      .from("runs")
      .insert({ task_id: task.id, user_id: user.id, attempt, feedback })
      .select("id")
      .single();
    if (error) throw error;
    await supabase.from("tasks").update({ status: "ready" }).eq("id", task.id);
    await supabase.from("events").insert({
      task_id: task.id,
      run_id: run.id,
      user_id: user.id,
      type: "run.feedback_queued",
      payload: { feedback, attempt },
    });
    return NextResponse.json({ runId: run.id }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
