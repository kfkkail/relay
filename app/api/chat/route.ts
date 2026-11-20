import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";

import {
  ATTACHMENT_BUCKET,
  normalizeImage,
  validateAttachmentRequest,
} from "@/lib/attachments";
import { chatIdPattern, chatUploadPath } from "@/lib/chat-image";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireUser();
    const id = new URL(request.url).searchParams.get("id");
    if (id && !chatIdPattern.test(id))
      throw new ApiError("Invalid conversation ID.");
    const { data: conversations, error } = await supabase
      .from("conversations")
      .select("id,title,updated_at")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    let turns: unknown[] = [];
    if (id) {
      const { data, error } = await supabase
        .from("tasks")
        .select(
          "id,chat_message,created_at,task_attachments(id,file_name),runs:runs!runs_task_id_fkey(id,status,result_markdown,error,attempt,result_documents(id,display_filename,mime_type,byte_size,description))",
        )
        .eq("conversation_id", id)
        .not("task_attachments.finalized_at", "is", null)
        .order("created_at", { ascending: false })
        .limit(100)
        .order("attempt", { referencedTable: "runs", ascending: false });
      if (error) throw error;
      turns = (data ?? []).reverse();
    }
    return NextResponse.json(
      { conversations, turns },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ApiError("A message object is required.");
    if (
      !chatIdPattern.test(body.conversationId ?? "") ||
      !chatIdPattern.test(body.messageId ?? "")
    )
      throw new ApiError("Invalid conversation or message ID.");
    if (
      typeof body.message !== "string" ||
      !body.message.trim() ||
      body.message.trim().length > 4000
    )
      throw new ApiError("Message must contain 1 to 4000 characters.");
    const args = {
      p_conversation_id: body.conversationId,
      p_message_id: body.messageId,
      p_message: body.message.trim(),
    };
    if (body.image === undefined) {
      const { data, error } = await supabase.rpc("send_chat_message", args);
      if (error) throwChatError(error);
      return NextResponse.json({ messageId: data }, { status: 201 });
    }

    const { image } = body;
    if (
      typeof image?.uploadId !== "string" ||
      !chatIdPattern.test(image.uploadId)
    )
      throw new ApiError("Invalid image upload ID.");
    const input = validateAttachmentRequest(
      image.fileName,
      image.mimeType,
      image.byteSize,
    );
    const bucket = createAdminClient().storage.from(ATTACHMENT_BUCKET);
    const stagedPath = chatUploadPath(user.id, image.uploadId.toLowerCase());
    const objectId = randomUUID();
    const storedPath = `${user.id}/${body.messageId.toLowerCase()}/${objectId}`;

    try {
      const { data: object, error: downloadError } =
        await bucket.download(stagedPath);
      if (downloadError || !object || object.size !== input.byteSize)
        throw new ApiError(
          "Could not read the uploaded image. Please try again.",
          422,
        );
      const normalized = await normalizeImage(
        Buffer.from(await object.arrayBuffer()),
        input.mimeType,
      );
      const { error: uploadError } = await bucket.upload(
        storedPath,
        normalized.data,
        {
          contentType: normalized.mimeType,
        },
      );
      if (uploadError) throw uploadError;

      const { data, error } = await supabase.rpc("send_chat_message", {
        ...args,
        p_image: {
          objectId,
          fileName: input.fileName,
          mimeType: normalized.mimeType,
          byteSize: normalized.data.byteLength,
          width: normalized.width,
          height: normalized.height,
        },
      });
      if (error) {
        // A database rejection rolls back the turn. A transport error may
        // arrive after commit, so keep the object when the outcome is unknown.
        if (
          /^[0-9A-Z]{5}$/.test(error.code) &&
          !error.code.startsWith("08") &&
          error.code !== "40003"
        )
          await removeUpload(bucket, storedPath);
        throwChatError(error);
      }
      if (data.storagePath !== storedPath)
        await removeUpload(bucket, storedPath);
      return NextResponse.json(
        {
          messageId: data.messageId,
          attachment: { id: data.messageId, file_name: input.fileName },
        },
        { status: 201 },
      );
    } finally {
      await removeUpload(bucket, stagedPath);
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}

type AttachmentBucket = ReturnType<
  ReturnType<typeof createAdminClient>["storage"]["from"]
>;

async function removeUpload(bucket: AttachmentBucket, path: string) {
  try {
    const { error } = await bucket.remove([path]);
    if (error) throw error;
  } catch (error) {
    console.error("Could not clean up chat upload", error);
  }
}

function throwChatError(error: { message: string }): never {
  if (error.message.includes("Wait for the current reply"))
    throw new ApiError(error.message, 409);
  throw error;
}
