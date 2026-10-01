import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";
import { TASK_SELECT } from "@/lib/task-select";
import { queueTask } from "@/lib/queue-task";
import { deliverableConflict, parseDeliverable } from "@/lib/deliverables";

export async function GET() {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("tasks")
      .select(TASK_SELECT)
      .order("updated_at", { ascending: false })
      .order("attempt", { referencedTable: "runs", ascending: false });
    if (error) throw error;
    return NextResponse.json({ tasks: data ?? [] });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const instructions =
      typeof body.instructions === "string" ? body.instructions.trim() : "";
    const parentTaskId =
      typeof body.parentTaskId === "string" ? body.parentTaskId : null;
    let deliverable;
    try {
      deliverable = parseDeliverable(body.deliverable);
    } catch {
      throw new ApiError("Choose a valid deliverable.");
    }
    if (!title) throw new ApiError("Task title is required.");

    const conflict = deliverableConflict(deliverable, instructions);
    if (conflict) throw new ApiError(conflict, 409);

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        user_id: user.id,
        title,
        instructions,
        deliverable,
        parent_task_id: parentTaskId,
      })
      .select(TASK_SELECT)
      .single();
    if (error) throw error;

    await supabase.from("events").insert({
      task_id: data.id,
      user_id: user.id,
      type: "task.created",
      payload: { ...(parentTaskId ? { parentTaskId } : {}), deliverable },
    });
    // Image uploads finish before the client queues the task.
    if (body.hasAttachment !== true) {
      try {
        await queueTask(supabase, user, data.id);
      } catch (error) {
        await supabase.from("tasks").delete().eq("id", data.id);
        throw error;
      }
      const { data: queuedTask, error: readError } = await supabase
        .from("tasks")
        .select(TASK_SELECT)
        .eq("id", data.id)
        .single();
      if (readError) throw readError;
      return NextResponse.json({ task: queuedTask }, { status: 201 });
    }
    return NextResponse.json({ task: data }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
