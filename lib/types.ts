export const taskStatuses = [
  "inbox",
  "ready",
  "working",
  "waiting",
  "done",
] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const runStatuses = [
  "queued",
  "working",
  "completed",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof runStatuses)[number];

export type ResultArtifact = {
  type: "link" | "file" | "branch" | "commit" | "pull_request" | "check";
  label: string;
  value: string;
  url?: string;
};

export type Run = {
  id: string;
  task_id: string;
  status: RunStatus;
  attempt: number;
  worker_id: string | null;
  feedback: string | null;
  result_markdown: string | null;
  result_artifacts: ResultArtifact[];
  error: string | null;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type TaskAttachment = {
  id: string;
  file_name: string;
  mime_type: "image/jpeg" | "image/png" | "image/webp";
  byte_size: number;
  width: number | null;
  height: number | null;
};

export type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  instructions: string;
  accepted_result: string | null;
  parent_task_id: string | null;
  created_at: string;
  updated_at: string;
  task_attachments: TaskAttachment[];
  runs: Run[];
};

export type Worker = {
  id: string;
  name: string;
  last_seen_at: string | null;
  created_at: string;
};

export const ownerActionStatuses = ["todo", "in_progress", "done"] as const;
export type OwnerActionStatus = (typeof ownerActionStatuses)[number];

export type OwnerActionTaskLink = {
  task_id: string;
  tasks: Pick<Task, "id" | "title" | "status"> | null;
};

export type OwnerAction = {
  id: string;
  title: string;
  notes: string;
  status: OwnerActionStatus;
  due_at: string | null;
  snoozed_until: string | null;
  position: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  owner_action_tasks: OwnerActionTaskLink[];
};
