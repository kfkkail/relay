import { NextResponse } from "next/server";
import { ATTACHMENT_BUCKET } from "@/lib/attachments";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";
import {
  onlyFinalizedOwnerActionAttachments,
  ownerActionDateUpdates,
  ownerActionSelect,
} from "@/lib/owner-actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { ownerActionStatuses } from "@/lib/types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ actionId: string }> },
) {
  try {
    const { actionId } = await params;
    const { supabase } = await requireUser();
    const body = await request.json();
    const updates: Record<string, unknown> = {};
    const { data: current, error: currentError } = await supabase
      .from("owner_actions")
      .select("due_at")
      .eq("id", actionId)
      .single();
    if (currentError || !current) throw new ApiError("Action not found.", 404);
    if ("title" in body) {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title || title.length > 160)
        throw new ApiError(
          "Action title must be between 1 and 160 characters.",
        );
      updates.title = title;
    }
    if ("notes" in body) {
      if (typeof body.notes !== "string" || body.notes.length > 20000)
        throw new ApiError("Notes must be 20,000 characters or fewer.");
      updates.notes = body.notes.trim();
    }
    if ("status" in body) {
      if (!ownerActionStatuses.includes(body.status))
        throw new ApiError("Invalid action status.");
      updates.status = body.status;
      updates.completed_at =
        body.status === "done" ? new Date().toISOString() : null;
    }
    try {
      Object.assign(updates, ownerActionDateUpdates(body, current.due_at));
    } catch (error) {
      throw new ApiError(
        error instanceof Error ? error.message : "Invalid action date.",
      );
    }
    if (!Object.keys(updates).length)
      throw new ApiError("No supported changes supplied.");
    const { data, error } = await supabase
      .from("owner_actions")
      .update(updates)
      .eq("id", actionId)
      .select(ownerActionSelect)
      .single();
    if (error || !data) throw new ApiError("Action not found.", 404);
    return NextResponse.json({
      action: onlyFinalizedOwnerActionAttachments(data),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ actionId: string }> },
) {
  try {
    const { actionId } = await params;
    const { supabase } = await requireUser();
    const { data: action, error: actionError } = await supabase
      .from("owner_actions")
      .select("id,owner_action_attachments(storage_path)")
      .eq("id", actionId)
      .single();
    if (actionError || !action) throw new ApiError("Action not found.", 404);
    const storagePaths = action.owner_action_attachments.map(
      (attachment) => attachment.storage_path,
    );
    // Delete the action first (its attachment rows cascade away); only then
    // sweep storage. A failed storage removal leaves harmless orphaned objects
    // rather than a half-deleted action whose photos 404.
    const { error, count } = await supabase
      .from("owner_actions")
      .delete({ count: "exact" })
      .eq("id", actionId);
    if (error) throw error;
    if (!count) throw new ApiError("Action not found.", 404);
    if (storagePaths.length) {
      const { error: storageError } = await createAdminClient()
        .storage.from(ATTACHMENT_BUCKET)
        .remove(storagePaths);
      if (storageError)
        console.error(
          "Could not remove owner action photos from storage",
          storageError,
        );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
