import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";

const taskSelect = `
  id,title,status,instructions,accepted_result,parent_task_id,created_at,updated_at,
  runs(id,task_id,status,attempt,worker_id,feedback,result_markdown,result_artifacts,error,queued_at,started_at,finished_at)
`;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const instructions = typeof body.instructions === "string" ? body.instructions : "";
    if (!title) throw new ApiError("Task title is required.");
    if (title.length > 160) {
      throw new ApiError("Task title must be 160 characters or fewer.");
    }
    if (!instructions.trim()) throw new ApiError("Markdown instructions are required.");
    if (instructions.length > 100000) {
      throw new ApiError("Markdown instructions must be 100,000 characters or fewer.");
    }

    const { data: task, error } = await supabase
      .from("tasks")
      .update({ title, instructions })
      .eq("id", taskId)
      .select(taskSelect)
      .single();
    if (error || !task) throw new ApiError("Task not found.", 404);

    await supabase.from("events").insert({
      task_id: task.id,
      user_id: user.id,
      type: "task.updated",
      payload: { fields: ["title", "instructions"] },
    });
    return NextResponse.json({ task });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
