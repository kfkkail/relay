export const ownerActionSelect = `
  id,title,notes,status,due_at,snoozed_until,position,completed_at,created_at,updated_at,
  owner_action_tasks(task_id,tasks(id,title,status))
`;

export function optionalDate(value: unknown, field: string) {
  if (value === null || value === "" || value === undefined) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be a valid date.`);
  }
  return new Date(value).toISOString();
}

export function futureOptionalDate(
  value: unknown,
  field: string,
  now = new Date(),
) {
  const date = optionalDate(value, field);
  if (date && new Date(date) <= now)
    throw new Error(`${field} must be in the future.`);
  return date;
}

export function ownerActionDateUpdates(
  body: Record<string, unknown>,
  currentDueAt: string | null,
  now = new Date(),
) {
  const updates: { due_at?: string | null; snoozed_until?: string | null } = {};
  const dueAt =
    "dueAt" in body ? optionalDate(body.dueAt, "Due date") : currentDueAt;

  if ("dueAt" in body) updates.due_at = dueAt;
  if ("snoozedUntil" in body) {
    const snoozedUntil = futureOptionalDate(
      body.snoozedUntil,
      "Hide until date",
      now,
    );
    if (snoozedUntil && dueAt && new Date(dueAt) <= now) {
      throw new Error("Overdue actions cannot be hidden.");
    }
    if (snoozedUntil && dueAt && new Date(snoozedUntil) > new Date(dueAt)) {
      throw new Error("Hide until date cannot be after the due date.");
    }
    updates.snoozed_until = snoozedUntil;
  }

  return updates;
}
