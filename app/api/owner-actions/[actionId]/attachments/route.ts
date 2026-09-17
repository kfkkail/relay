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
    const attachmentId = randomUUID();
    const storagePath = `${user.id}/owner-actions/${actionId}/${attachmentId}`;
    const admin = createAdminClient();
    const { data: reservation, error: reservationError } = await admin.rpc(
      "reserve_owner_action_attachment",
      {
        p_user_id: user.id,
        p_action_id: actionId,
        p_attachment_id: attachmentId,
        p_storage_path: storagePath,
        p_file_name: input.fileName,
        p_mime_type: input.mimeType,
        p_byte_size: input.byteSize,
        p_limit: MAX_OWNER_ACTION_ATTACHMENTS,
      },
    );
    if (reservationError) throw reservationError;
    const result = parseReservation(reservation);
    await cleanupAbandonedAttachments(supabase, admin, result.abandoned);
    if (result.status === "not_found")
      throw new ApiError("Action not found.", 404);
    if (result.status === "limit_reached")
      throw new ApiError(
        `An action can have up to ${MAX_OWNER_ACTION_ATTACHMENTS} photos.`,
        409,
      );
    if (result.status !== "created")
      throw new Error("Unexpected attachment reservation response.");
    const { data: upload, error: uploadError } = await admin.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUploadUrl(storagePath);
    if (uploadError) {
      await supabase
        .from("owner_action_attachments")
        .delete()
        .eq("id", attachmentId);
      throw uploadError;
    }
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
      .is("abandoned_at", null)
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
    const { data, error } = await admin
      .from("owner_action_attachments")
      .update({
        mime_type: normalized.mimeType,
        byte_size: normalized.data.byteLength,
        width: normalized.width,
        height: normalized.height,
        finalized_at: new Date().toISOString(),
      })
      .eq("id", attachment.id)
      .eq("owner_action_id", actionId)
      .is("abandoned_at", null)
      .select("id,file_name,mime_type,byte_size,width,height,finalized_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ attachment: data });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

type ReservationStatus = "created" | "limit_reached" | "not_found";
type AbandonedAttachment = { id: string; storagePath: string };

function parseReservation(value: unknown): {
  status: ReservationStatus | null;
  abandoned: AbandonedAttachment[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { status: null, abandoned: [] };
  const record = value as Record<string, unknown>;
  const status = ["created", "limit_reached", "not_found"].includes(
    String(record.status),
  )
    ? (record.status as ReservationStatus)
    : null;
  const abandoned = Array.isArray(record.abandoned)
    ? record.abandoned.filter((item): item is AbandonedAttachment =>
        Boolean(
          item &&
            typeof item === "object" &&
            typeof (item as AbandonedAttachment).id === "string" &&
            typeof (item as AbandonedAttachment).storagePath === "string",
        ),
      )
    : [];
  return { status, abandoned };
}

async function cleanupAbandonedAttachments(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  admin: ReturnType<typeof createAdminClient>,
  abandoned: AbandonedAttachment[],
) {
  if (!abandoned.length) return;
  const { error: storageError } = await admin.storage
    .from(ATTACHMENT_BUCKET)
    .remove(abandoned.map((attachment) => attachment.storagePath));
  if (storageError) {
    console.error(
      "Could not clean up abandoned owner action photos",
      storageError,
    );
    return;
  }
  const { error } = await supabase
    .from("owner_action_attachments")
    .delete()
    .in(
      "id",
      abandoned.map((attachment) => attachment.id),
    )
    .not("abandoned_at", "is", null);
  if (error)
    console.error("Could not remove abandoned owner action photo rows", error);
}
