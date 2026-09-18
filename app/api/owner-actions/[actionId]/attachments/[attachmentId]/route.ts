import { NextResponse } from "next/server";
import { ATTACHMENT_BUCKET } from "@/lib/attachments";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ actionId: string; attachmentId: string }> },
) {
  try {
    const { actionId, attachmentId } = await params;
    const { supabase } = await requireUser();
    const { data } = await supabase
      .from("owner_action_attachments")
      .select("storage_path,file_name,mime_type")
      .eq("id", attachmentId)
      .eq("owner_action_id", actionId)
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
  { params }: { params: Promise<{ actionId: string; attachmentId: string }> },
) {
  try {
    const { actionId, attachmentId } = await params;
    const { supabase } = await requireUser();
    const { data } = await supabase
      .from("owner_action_attachments")
      .select("storage_path")
      .eq("id", attachmentId)
      .eq("owner_action_id", actionId)
      .single();
    if (!data) throw new ApiError("Attachment not found.", 404);
    // Delete the row first so the attachment disappears from the user's view
    // even if storage cleanup fails; a leftover object is a harmless orphan we
    // sweep later, whereas a leftover row would render as a broken image.
    const { error } = await supabase
      .from("owner_action_attachments")
      .delete()
      .eq("id", attachmentId);
    if (error) throw error;
    const { error: storageError } = await createAdminClient()
      .storage.from(ATTACHMENT_BUCKET)
      .remove([data.storage_path]);
    if (storageError)
      console.error(
        "Could not remove owner action photo from storage",
        storageError,
      );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
