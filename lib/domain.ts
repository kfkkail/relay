import type { OwnerAction, Run, Task, TaskStatus } from "@/lib/types";

export const ACTIVE_RUN_STATUSES = new Set(["queued", "working"]);

export function hasActiveRun(runs: Pick<Run, "status">[]) {
  return runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status));
}

export function latestCompletedRun(runs: Run[]) {
  return [...runs]
    .filter((run) => run.status === "completed" && run.result_markdown)
    .sort((left, right) => right.attempt - left.attempt)[0];
}

export function buildFollowUpInstructions(
  task: Pick<Task, "title" | "accepted_result">,
) {
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
    waiting: "Review",
    done: "Done",
  }[status];
}

export type OwnerActionFilter = "active" | "snoozed" | "done";

export function ownerActionFilter(
  action: OwnerAction,
  now = new Date(),
): OwnerActionFilter {
  if (action.status === "done") return "done";
  const snoozed = action.snoozed_until && new Date(action.snoozed_until) > now;
  const due = action.due_at && new Date(action.due_at) <= now;
  if (snoozed && !due) return "snoozed";
  return "active";
}

export function compareOwnerActions(left: OwnerAction, right: OwnerAction) {
  if (!left.due_at) return right.due_at ? 1 : 0;
  if (!right.due_at) return -1;
  return new Date(left.due_at).getTime() - new Date(right.due_at).getTime();
}
