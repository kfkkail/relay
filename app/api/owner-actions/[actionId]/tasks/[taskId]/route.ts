import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";

export async function DELETE(_request: Request, { params }: { params: Promise<{ actionId: string; taskId: string }> }) {
  try {
    const { actionId, taskId } = await params;
    const { supabase } = await requireUser();
    const { error, count } = await supabase.from("owner_action_tasks").delete({ count: "exact" }).eq("owner_action_id", actionId).eq("task_id", taskId);
    if (error) throw error;
    if (!count) throw new ApiError("Action link not found.", 404);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
