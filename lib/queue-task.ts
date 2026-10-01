import { ApiError } from "@/lib/http";
import { TASK_RUN_SUMMARY_SELECT } from "@/lib/task-select";
import { deliverableConflict } from "@/lib/deliverables";
import type { requireUser } from "@/lib/http";

export async function queueTask(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  user: { id: string },
  taskId: string,
) {
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select(TASK_RUN_SUMMARY_SELECT)
    .eq("id", taskId)
    .single();
  if (taskError || !task) throw new ApiError("Task not found.", 404);
  if (
    task.runs.some((run) => run.status === "queued" || run.status === "working")
  ) {
    throw new ApiError("This task already has an active run.", 409);
  }
  const conflict = deliverableConflict(task.deliverable, task.instructions);
  if (conflict) {
    await supabase.from("events").insert({
      task_id: task.id,
      user_id: user.id,
      type: "run.deliverable_blocked",
      payload: {
        deliverable: task.deliverable,
        reason: "markdown_conflict",
      },
    });
    throw new ApiError(conflict, 409);
  }
  const { data: runId, error } = await supabase.rpc("queue_task", {
    p_task_id: taskId,
  });
  if (error) throw error;
  return runId as string;
}
