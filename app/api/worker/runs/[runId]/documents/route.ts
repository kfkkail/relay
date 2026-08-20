import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { requireWorker } from "@/lib/worker-auth";
import {
  MAX_DOCUMENTS,
  MAX_DOCUMENT_TOTAL_BYTES,
  validateDocumentBytes,
} from "@/lib/result-documents";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  let uploadedPath: string | undefined;
  try {
    const { runId } = await params;
    const { supabase, worker } = await requireWorker(request);
    const { data: run } = await supabase
      .from("runs")
      .select("id,task_id,user_id")
      .eq("id", runId)
      .eq("worker_id", worker.id)
      .eq("status", "working")
      .maybeSingle();
    if (!run) throw new ApiError("Active run not found for this worker.", 404);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      throw new ApiError("Document file is required.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const { mimeType, displayFilename } = validateDocumentBytes(
      file.name,
      bytes,
    );
    const { data: existing } = await supabase
      .from("result_documents")
      .select("byte_size")
      .eq("run_id", run.id);
    if ((existing?.length ?? 0) >= MAX_DOCUMENTS)
      throw new ApiError("A run may include at most 10 documents.");
    const total = (existing ?? []).reduce(
      (sum, item) => sum + Number(item.byte_size),
      0,
    );
    if (total + bytes.length > MAX_DOCUMENT_TOTAL_BYTES)
      throw new ApiError("Run documents may total at most 25 MB.");
    const documentId = randomUUID();
    uploadedPath = `${run.user_id}/${run.task_id}/${run.id}/${documentId}`;
    const { error: uploadError } = await supabase.storage
      .from("result-documents")
      .upload(uploadedPath, bytes, { contentType: mimeType, upsert: false });
    if (uploadError) throw uploadError;
    const description =
      typeof form.get("description") === "string"
        ? String(form.get("description")).trim().slice(0, 500) || null
        : null;
    const { data: document, error } = await supabase
      .from("result_documents")
      .insert({
        id: documentId,
        run_id: run.id,
        task_id: run.task_id,
        user_id: run.user_id,
        storage_path: uploadedPath,
        display_filename: displayFilename,
        mime_type: mimeType,
        byte_size: bytes.length,
        description,
      })
      .select("id,display_filename,mime_type,byte_size,description")
      .single();
    if (error) throw error;
    return NextResponse.json({ document });
  } catch (error) {
    if (uploadedPath) {
      try {
        const { supabase } = await requireWorker(request);
        await supabase.storage.from("result-documents").remove([uploadedPath]);
      } catch {}
    }
    return apiErrorResponse(error);
  }
}
