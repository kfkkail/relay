import { NextResponse } from "next/server";
import { ATTACHMENT_BUCKET } from "@/lib/attachments";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string; attachmentId: string }> },
) {
  try {
    const { taskId, attachmentId } = await params;
    const { supabase } = await requireUser();
    const { data } = await supabase
      .from("task_attachments")
      .select("storage_path,file_name,mime_type")
      .eq("id", attachmentId)
      .eq("task_id", taskId)
      .not("finalized_at", "is", null)
      .single();
    if (!data) throw new ApiError("Attachment not found.", 404);
    const { data: object, error } = await createAdminClient()
      .storage.from(ATTACHMENT_BUCKET)
      .download(data.storage_path);
    if (error || !object)
      throw new ApiError("Attachment data is unavailable.", 404);
    return new NextResponse(object.stream(), {
      headers: {
        "Content-Type": data.mime_type,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(data.file_name)}`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ taskId: string; attachmentId: string }> },
) {
  try {
    const { taskId, attachmentId } = await params;
    const { supabase, user } = await requireUser();
    const { data } = await supabase
      .from("task_attachments")
      .select("storage_path,tasks!inner(status)")
      .eq("id", attachmentId)
      .eq("task_id", taskId)
      .single();
    if (!data) throw new ApiError("Attachment not found.", 404);
    if ((data.tasks as unknown as { status: string }).status !== "inbox")
      throw new ApiError(
        "Attachments can only be changed while a task is in Inbox.",
        409,
      );
    const { error: storageError } = await createAdminClient()
      .storage.from(ATTACHMENT_BUCKET)
      .remove([data.storage_path]);
    if (storageError) throw storageError;
    const { error } = await supabase
      .from("task_attachments")
      .delete()
      .eq("id", attachmentId);
    if (error) throw error;
    await supabase.from("events").insert({
      task_id: taskId,
      user_id: user.id,
      type: "task.attachment_removed",
      payload: { attachmentId },
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
