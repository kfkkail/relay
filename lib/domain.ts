import type { Run, Task, TaskStatus } from "@/lib/types";

export const ACTIVE_RUN_STATUSES = new Set(["queued", "working"]);

export function hasActiveRun(runs: Pick<Run, "status">[]) {
  return runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status));
}

export function latestCompletedRun(runs: Run[]) {
  return [...runs]
    .filter((run) => run.status === "completed" && run.result_markdown)
    .sort((left, right) => right.attempt - left.attempt)[0];
}

export function buildFollowUpInstructions(task: Pick<Task, "title" | "accepted_result">) {
  if (!task.accepted_result) {
    throw new Error("Accept a result before creating a follow-up task.");
  }

  return [
    `## Context from ${task.title}`,
    "",
    task.accepted_result.trim(),
    "",
    "## Next step",
    "",
    "Describe what should be done next.",
  ].join("\n");
}

export function statusLabel(status: TaskStatus) {
  return {
    inbox: "Inbox",
    ready: "Ready",
    working: "Working",
    waiting: "Waiting",
    done: "Done",
  }[status];
}
