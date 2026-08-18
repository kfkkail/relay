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
