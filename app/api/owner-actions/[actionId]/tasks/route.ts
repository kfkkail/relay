import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";
import {
  onlyFinalizedOwnerActionAttachments,
  ownerActionSelect,
} from "@/lib/owner-actions";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ actionId: string }> },
) {
  try {
    const { actionId } = await params;
    const { supabase, user } = await requireUser();
    const body = await request.json();
    if (typeof body.taskId !== "string")
      throw new ApiError("Task is required.");
    const { error } = await supabase.from("owner_action_tasks").insert({
      owner_action_id: actionId,
      task_id: body.taskId,
      user_id: user.id,
    });
    if (error) throw error;
    const { data, error: actionError } = await supabase
      .from("owner_actions")
      .select(ownerActionSelect)
      .eq("id", actionId)
      .single();
    if (actionError || !data) throw new ApiError("Action not found.", 404);
    return NextResponse.json(
      { action: onlyFinalizedOwnerActionAttachments(data) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
