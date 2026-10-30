// Client-safe attachment constants. Kept separate from lib/attachments.ts so
// they can be imported into client components without pulling in the server-only
// `sharp` dependency.
export const ATTACHMENT_BUCKET = "task-attachments";
