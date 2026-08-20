import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, requireUser } from "@/lib/http";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string; documentId: string }> },
) {
  try {
    const { taskId, documentId } = await params;
    const { supabase, user } = await requireUser();
    const { data: document } = await supabase
      .from("result_documents")
      .select("storage_path,display_filename,mime_type")
      .eq("id", documentId)
      .eq("task_id", taskId)
      .eq("user_id", user.id)
      .eq("staged", false)
      .maybeSingle();
    if (!document) throw new ApiError("Document not found.", 404);
    const { data, error } = await supabase.storage
      .from("result-documents")
      .download(document.storage_path);
    if (error || !data)
      throw new ApiError("Document could not be downloaded.", 404);
    const dispositionType = new URL(request.url).searchParams.has("inline")
      ? "inline"
      : "attachment";
    const disposition = `${dispositionType}; filename*=UTF-8''${encodeURIComponent(document.display_filename)}`;
    return new NextResponse(data, {
      headers: {
        "Content-Type": document.mime_type,
        "Content-Disposition": disposition,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
