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
    waiting: "Needs attention",
    done: "Done",
  }[status];
}

export type OwnerActionFilter = "active" | "snoozed" | "done";

export function ownerActionFilter(action: OwnerAction, now = new Date()): OwnerActionFilter {
  if (action.status === "done") return "done";
  if (action.snoozed_until && new Date(action.snoozed_until) > now) return "snoozed";
  return "active";
}

export function compareOwnerActions(left: OwnerAction, right: OwnerAction, now = new Date()) {
  const dueRank = (action: OwnerAction) => {
    if (!action.due_at) return 2;
    return new Date(action.due_at) < now ? 0 : 1;
  };
  const rankDifference = dueRank(left) - dueRank(right);
  if (rankDifference) return rankDifference;
  if (left.due_at && right.due_at) {
    const dueDifference = new Date(left.due_at).getTime() - new Date(right.due_at).getTime();
    if (dueDifference) return dueDifference;
  }
  return left.position - right.position;
}
