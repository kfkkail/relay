import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  ATTACHMENT_BUCKET,
  normalizeImage,
  validateAttachmentRequest,
} from "@/lib/attachments";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";
import { MAX_OWNER_ACTION_ATTACHMENTS } from "@/lib/owner-actions";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ actionId: string }> },
) {
  try {
    const { actionId } = await params;
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const input = validateAttachmentRequest(
      body.fileName,
      body.mimeType,
      body.byteSize,
    );
    const { data: action } = await supabase
      .from("owner_actions")
      .select("id,owner_action_attachments(id)")
      .eq("id", actionId)
      .single();
    if (!action) throw new ApiError("Action not found.", 404);
    if (action.owner_action_attachments.length >= MAX_OWNER_ACTION_ATTACHMENTS)
      throw new ApiError(
        `An action can have up to ${MAX_OWNER_ACTION_ATTACHMENTS} photos.`,
        409,
      );

    const attachmentId = randomUUID();
    const storagePath = `${user.id}/owner-actions/${action.id}/${attachmentId}`;
    const { data: upload, error: uploadError } = await createAdminClient()
      .storage.from(ATTACHMENT_BUCKET)
      .createSignedUploadUrl(storagePath);
    if (uploadError) throw uploadError;
    const { error } = await supabase.from("owner_action_attachments").insert({
      id: attachmentId,
      owner_action_id: action.id,
      user_id: user.id,
      storage_path: storagePath,
      file_name: input.fileName,
      mime_type: input.mimeType,
      byte_size: input.byteSize,
    });
    if (error) throw error;
    return NextResponse.json(
      { attachmentId, path: storagePath, token: upload.token },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ actionId: string }> },
) {
  try {
    const { actionId } = await params;
    const { supabase } = await requireUser();
    const { attachmentId } = await request.json();
    const { data: attachment } = await supabase
      .from("owner_action_attachments")
      .select("id,storage_path,mime_type")
      .eq("id", attachmentId)
      .eq("owner_action_id", actionId)
      .single();
    if (!attachment) throw new ApiError("Attachment not found.", 404);
    const admin = createAdminClient();
    const { data: object, error: downloadError } = await admin.storage
      .from(ATTACHMENT_BUCKET)
      .download(attachment.storage_path);
    if (downloadError || !object)
      throw new ApiError(
        "Uploaded image could not be found. Please retry the upload.",
        422,
      );
    let normalized;
    try {
      normalized = await normalizeImage(
        Buffer.from(await object.arrayBuffer()),
        attachment.mime_type,
      );
    } catch (error) {
      await admin.storage
        .from(ATTACHMENT_BUCKET)
        .remove([attachment.storage_path]);
      await supabase
        .from("owner_action_attachments")
        .delete()
        .eq("id", attachment.id);
      throw error;
    }
    const { error: replaceError } = await admin.storage
      .from(ATTACHMENT_BUCKET)
      .update(attachment.storage_path, normalized.data, {
        contentType: normalized.mimeType,
        upsert: true,
      });
    if (replaceError) throw replaceError;
    const { data, error } = await supabase
      .from("owner_action_attachments")
      .update({
        mime_type: normalized.mimeType,
        byte_size: normalized.data.byteLength,
        width: normalized.width,
        height: normalized.height,
        finalized_at: new Date().toISOString(),
      })
      .eq("id", attachment.id)
      .select("id,file_name,mime_type,byte_size,width,height")
      .single();
    if (error) throw error;
    return NextResponse.json({ attachment: data });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
