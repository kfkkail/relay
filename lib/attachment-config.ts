export const ATTACHMENT_BUCKET = "task-attachments";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const attachmentMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type AttachmentMimeType = (typeof attachmentMimeTypes)[number];
