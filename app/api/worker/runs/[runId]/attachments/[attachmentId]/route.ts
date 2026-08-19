import { NextResponse } from "next/server";
import { ATTACHMENT_BUCKET } from "@/lib/attachments";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { requireWorker } from "@/lib/worker-auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string; attachmentId: string }> },
) {
  try {
    const { runId, attachmentId } = await params;
    const { supabase, worker } = await requireWorker(request);
    const { data } = await supabase
      .from("run_attachments")
      .select(
        "storage_path,file_name,mime_type,byte_size,runs!inner(worker_id,status)",
      )
      .eq("run_id", runId)
      .eq("attachment_id", attachmentId)
      .single();
    if (
      !data ||
      (data.runs as unknown as { worker_id: string }).worker_id !== worker.id
    )
      throw new ApiError("Run attachment not found.", 404);
    const { data: object, error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .download(data.storage_path);
    if (error || !object)
      throw new ApiError("Run attachment data is unavailable.", 422);
    if (object.size !== data.byte_size || object.type !== data.mime_type)
      throw new ApiError("Run attachment no longer matches its snapshot.", 422);
    return new NextResponse(object.stream(), {
      headers: {
        "Content-Type": data.mime_type,
        "Content-Length": String(data.byte_size),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(data.file_name)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
