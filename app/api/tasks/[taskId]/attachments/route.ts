import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ATTACHMENT_BUCKET, normalizeImage, validateAttachmentRequest } from "@/lib/attachments";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const input = validateAttachmentRequest(body.fileName, body.mimeType, body.byteSize);
    const { data: task } = await supabase.from("tasks").select("id,status,task_attachments(id)").eq("id", taskId).single();
    if (!task) throw new ApiError("Task not found.", 404);
    if (task.status !== "inbox") throw new ApiError("Attachments can only be changed while a task is in Inbox.", 409);
    if (task.task_attachments.length) throw new ApiError("This task already has an image. Remove it before adding another.", 409);

    const attachmentId = randomUUID();
    const storagePath = `${user.id}/${task.id}/${attachmentId}`;
    const admin = createAdminClient();
    const { data: upload, error: uploadError } = await admin.storage.from(ATTACHMENT_BUCKET).createSignedUploadUrl(storagePath);
    if (uploadError) throw uploadError;
    const { error } = await supabase.from("task_attachments").insert({
      id: attachmentId, task_id: task.id, user_id: user.id, storage_path: storagePath,
      file_name: input.fileName, mime_type: input.mimeType, byte_size: input.byteSize,
    });
    if (error) throw error;
    return NextResponse.json({ attachmentId, path: storagePath, token: upload.token }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    const { supabase, user } = await requireUser();
    const { attachmentId } = await request.json();
    const { data: attachment } = await supabase.from("task_attachments")
      .select("id,task_id,storage_path,file_name,mime_type,byte_size,tasks!inner(status)")
      .eq("id", attachmentId).eq("task_id", taskId).single();
    if (!attachment) throw new ApiError("Attachment not found.", 404);
    if ((attachment.tasks as unknown as { status: string }).status !== "inbox") throw new ApiError("Attachments can only be changed while a task is in Inbox.", 409);
    const admin = createAdminClient();
    const { data: object, error: downloadError } = await admin.storage.from(ATTACHMENT_BUCKET).download(attachment.storage_path);
    if (downloadError || !object) throw new ApiError("Uploaded image could not be found. Please retry the upload.", 422);
    let normalized;
    try {
      normalized = await normalizeImage(Buffer.from(await object.arrayBuffer()), attachment.mime_type);
    } catch (error) {
      await admin.storage.from(ATTACHMENT_BUCKET).remove([attachment.storage_path]);
      await supabase.from("task_attachments").delete().eq("id", attachment.id);
      throw error;
    }
    const { error: replaceError } = await admin.storage.from(ATTACHMENT_BUCKET).update(
      attachment.storage_path, normalized.data, { contentType: normalized.mimeType, upsert: true },
    );
    if (replaceError) throw replaceError;
    const { data, error } = await supabase.from("task_attachments").update({
      mime_type: normalized.mimeType, byte_size: normalized.data.byteLength,
      width: normalized.width, height: normalized.height, finalized_at: new Date().toISOString(),
    }).eq("id", attachment.id).select("id,file_name,mime_type,byte_size,width,height").single();
    if (error) throw error;
    await supabase.from("events").insert({ task_id: taskId, user_id: user.id, type: "task.attachment_added", payload: { attachmentId } });
    return NextResponse.json({ attachment: data });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
