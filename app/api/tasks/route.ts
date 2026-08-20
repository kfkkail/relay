import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";

const taskSelect = `
  id,title,status,instructions,accepted_result,accepted_run_id,parent_task_id,created_at,updated_at,
  task_attachments(id,file_name,mime_type,byte_size,width,height),
  runs(id,task_id,status,attempt,worker_id,feedback,result_markdown,result_artifacts,error,queued_at,started_at,finished_at,result_documents(id,display_filename,mime_type,byte_size,description))
`;

export async function GET() {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("tasks")
      .select(taskSelect)
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
    if (!title) throw new ApiError("Task title is required.");
    if (!instructions)
      throw new ApiError("Markdown instructions are required.");

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        user_id: user.id,
        title,
        instructions,
        parent_task_id: parentTaskId,
      })
      .select(taskSelect)
      .single();
    if (error) throw error;

    await supabase.from("events").insert({
      task_id: data.id,
      user_id: user.id,
      type: "task.created",
      payload: parentTaskId ? { parentTaskId } : {},
    });
    return NextResponse.json({ task: data }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
