import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const { supabase, user } = await requireUser();
    const { data: run, error: runError } = await supabase
      .from("runs")
      .select("id,result_markdown,attempt")
      .eq("task_id", taskId)
      .eq("status", "completed")
      .not("result_markdown", "is", null)
      .order("attempt", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runError || !run?.result_markdown) {
      throw new ApiError("No completed result is available to accept.", 409);
    }
    const { error } = await supabase
      .from("tasks")
      .update({
        accepted_result: run.result_markdown,
        accepted_run_id: run.id,
        status: "done",
      })
      .eq("id", taskId);
    if (error) throw error;
    await supabase.from("events").insert({
      task_id: taskId,
      run_id: run.id,
      user_id: user.id,
      type: "result.accepted",
      payload: { attempt: run.attempt },
    });
    return NextResponse.json({ accepted: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
