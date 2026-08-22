import type { TaskStatus } from "@/lib/types";

export type MyWorkFilter = "active" | "snoozed" | "done";

const taskFilters = new Set<TaskStatus>([
  "inbox",
  "ready",
  "working",
  "waiting",
  "done",
]);
const myWorkFilters = new Set<MyWorkFilter>(["active", "snoozed", "done"]);

export function parseTaskFilter(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && taskFilters.has(candidate as TaskStatus)
    ? (candidate as TaskStatus)
    : "inbox";
}

export function parseMyWorkFilter(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && myWorkFilters.has(candidate as MyWorkFilter)
    ? (candidate as MyWorkFilter)
    : "active";
}

export function safeReturnPath(
  value: string | string[] | null | undefined,
  fallback = "/tasks",
) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, "https://relay.local");
    return parsed.origin === "https://relay.local"
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}
