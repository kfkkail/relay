import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { requireWorker } from "@/lib/worker-auth";
import type { ResultArtifact } from "@/lib/types";
import { notifyTaskWaiting } from "@/lib/push-notifications";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    const { supabase, worker } = await requireWorker(request);
    const body = await request.json();
    const resultMarkdown = typeof body.resultMarkdown === "string" ? body.resultMarkdown.trim() : "";
    const artifacts = sanitizeArtifacts(body.artifacts);
    if (!resultMarkdown) throw new ApiError("Markdown result is required.");

    const { data: run, error: runError } = await supabase
      .from("runs")
      .select("id,task_id,user_id,attempt,tasks(title)")
      .eq("id", runId)
      .eq("worker_id", worker.id)
      .eq("status", "working")
      .maybeSingle();
    if (runError || !run) throw new ApiError("Active run not found for this worker.", 404);

    const finishedAt = new Date().toISOString();
    const { error } = await supabase
      .from("runs")
      .update({
        status: "completed",
        result_markdown: resultMarkdown,
        result_artifacts: artifacts,
        finished_at: finishedAt,
      })
      .eq("id", run.id);
    if (error) throw error;
    await supabase.from("tasks").update({ status: "waiting" }).eq("id", run.task_id);
    await supabase.from("events").insert({
      task_id: run.task_id,
      run_id: run.id,
      user_id: run.user_id,
      type: "run.completed",
      payload: { attempt: run.attempt, artifactCount: artifacts.length },
    });
    await notifyTaskWaiting(supabase, {
      id: run.task_id,
      user_id: run.user_id,
      title: run.tasks[0]?.title ?? "A task",
    });
    return NextResponse.json({ completed: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
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
    ) return [];

    let url: string | undefined;
    if (typeof artifact.url === "string") {
      try {
        const parsed = new URL(artifact.url);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") url = parsed.toString();
      } catch {
        // Invalid or non-web URLs are omitted rather than made clickable.
      }
    }

    return [{
      type: artifact.type as ResultArtifact["type"],
      label: artifact.label.slice(0, 200),
      value: artifact.value.slice(0, 2000),
      ...(url ? { url } : {}),
    }];
  });
}
