type HeartbeatRun = {
  status: string;
  agent_heartbeat_at?: string | null;
  started_at?: string | null;
};

// Leave room for a configured 60-second interval and a 30-second HTTP deadline.
export function workerConnectionInterrupted(
  run: HeartbeatRun,
  now = Date.now(),
) {
  if (run.status !== "working") return false;
  const timestamp = run.agent_heartbeat_at ?? run.started_at;
  if (!timestamp) return false;
  const age = now - Date.parse(timestamp);
  return Number.isFinite(age) && age >= 120_000;
}
