import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { requireWorker } from "@/lib/worker-auth";
import type { ResultArtifact } from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    const { supabase, worker } = await requireWorker(request);
    const body = await request.json();
    const resultMarkdown =
      typeof body.resultMarkdown === "string" ? body.resultMarkdown.trim() : "";
    const artifacts = sanitizeArtifacts(body.artifacts);
    const documentIds = sanitizeDocumentIds(body.documentIds);
    if (!resultMarkdown) throw new ApiError("Markdown result is required.");

    const { data: run, error: runError } = await supabase
      .from("runs")
      .select("id,task_id,user_id,attempt")
      .eq("id", runId)
      .eq("worker_id", worker.id)
      .eq("status", "working")
      .maybeSingle();
    if (runError || !run)
      throw new ApiError("Active run not found for this worker.", 404);

    const { error } = await supabase.rpc("complete_run_with_documents", {
      p_run_id: run.id,
      p_worker_id: worker.id,
      p_result_markdown: resultMarkdown,
      p_result_artifacts: artifacts,
      p_document_ids: documentIds,
    });
    if (error) throw error;
    return NextResponse.json({ completed: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function sanitizeDocumentIds(input: unknown) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 10)
    throw new ApiError("Document IDs must be an array of at most 10 items.");
  const ids = input.filter(
    (value): value is string =>
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
  );
  if (ids.length !== input.length || new Set(ids).size !== ids.length)
    throw new ApiError("Document IDs are invalid.");
  return ids;
}

const artifactTypes = new Set<ResultArtifact["type"]>([
  "link",
  "file",
  "branch",
  "commit",
  "pull_request",
  "check",
]);

function sanitizeArtifacts(input: unknown): ResultArtifact[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 20).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const artifact = value as Record<string, unknown>;
    if (
      typeof artifact.type !== "string" ||
      !artifactTypes.has(artifact.type as ResultArtifact["type"]) ||
      typeof artifact.label !== "string" ||
      typeof artifact.value !== "string"
    )
      return [];

    let url: string | undefined;
    if (typeof artifact.url === "string") {
      try {
        const parsed = new URL(artifact.url);
        if (parsed.protocol === "https:" || parsed.protocol === "http:")
          url = parsed.toString();
      } catch {
        // Invalid or non-web URLs are omitted rather than made clickable.
      }
    }

    return [
      {
        type: artifact.type as ResultArtifact["type"],
        label: artifact.label.slice(0, 200),
        value: artifact.value.slice(0, 2000),
        ...(url ? { url } : {}),
      },
    ];
  });
}
