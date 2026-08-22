import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";
import { TASK_SELECT } from "@/lib/task-select";
import { parseDeliverable } from "@/lib/deliverables";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const instructions =
      typeof body.instructions === "string" ? body.instructions : "";
    let deliverable;
    try { deliverable = parseDeliverable(body.deliverable); } catch { throw new ApiError("Choose a valid deliverable."); }
    if (!title) throw new ApiError("Task title is required.");
    if (title.length > 160) {
      throw new ApiError("Task title must be 160 characters or fewer.");
    }
    if (instructions.length > 100000) {
      throw new ApiError(
        "Markdown instructions must be 100,000 characters or fewer.",
      );
    }

    const { data: task, error } = await supabase
      .from("tasks")
      .update({ title, instructions, deliverable })
      .eq("id", taskId)
      .eq("status", "inbox")
      .select(TASK_SELECT)
      .single();
    if (error || !task) throw new ApiError("Task not found.", 404);

    await supabase.from("events").insert({
      task_id: task.id,
      user_id: user.id,
      type: "task.updated",
      payload: { fields: ["title", "instructions", "deliverable"] },
    });
    return NextResponse.json({ task });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
