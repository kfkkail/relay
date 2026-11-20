import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  ATTACHMENT_BUCKET,
  validateAttachmentRequest,
} from "@/lib/attachments";
import { chatUploadPath } from "@/lib/chat-image";
import { apiErrorResponse, requireUser } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    const body = await request.json();
    validateAttachmentRequest(body?.fileName, body?.mimeType, body?.byteSize);
    const uploadId = randomUUID();
    const path = chatUploadPath(user.id, uploadId);
    const { data, error } = await createAdminClient()
      .storage.from(ATTACHMENT_BUCKET)
      .createSignedUploadUrl(path);
    if (error) throw error;
    return NextResponse.json(
      { uploadId, path, token: data.token },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
