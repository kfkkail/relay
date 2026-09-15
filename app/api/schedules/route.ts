import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";

export async function GET() {
  try {
    const { supabase } = await requireUser();
    const [
      { data: schedules, error },
      { data: occurrences, error: historyError },
    ] = await Promise.all([
      supabase
        .from("task_schedules")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("schedule_occurrences")
        .select(
          "id,schedule_id,due_at,task_id,trigger,created_at,tasks(title,runs:runs!runs_task_id_fkey(status,finished_at))",
        )
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (error || historyError) throw error || historyError;
    return NextResponse.json({ schedules, occurrences });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase } = await requireUser();
    const body = await request.json();
    if (body.action === "preview") {
      const { data, error } = await supabase.rpc("preview_task_schedule", {
        p_config: body.config,
      });
      if (error)
        throw new ApiError(
          "Choose a valid timezone, days, and time window.",
          400,
        );
      return NextResponse.json({ slots: data });
    }
    if (body.action === "run") {
      const { data, error } = await supabase.rpc("run_task_schedule", {
        p_id: body.id,
        p_request: body.requestId,
      });
      if (error) throw new ApiError(error.message, 400);
      if (!data)
        throw new ApiError(
          "This schedule is archived or already has queued or running work.",
          409,
        );
      return NextResponse.json({ taskId: data });
    }
    const { data, error } = await supabase.rpc("save_task_schedule", {
      p_id: body.id ?? null,
      p_config: body.config,
    });
    if (error) throw new ApiError(error.message, 400);
    return NextResponse.json({ id: data });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
