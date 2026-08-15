export const taskStatuses = ["inbox", "ready", "working", "waiting", "done"] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const runStatuses = ["queued", "working", "completed", "failed", "cancelled"] as const;
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

export type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  instructions: string;
  accepted_result: string | null;
  parent_task_id: string | null;
  created_at: string;
  updated_at: string;
  runs: Run[];
};

export type Worker = {
  id: string;
  name: string;
  last_seen_at: string | null;
  created_at: string;
};
