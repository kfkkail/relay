export const chatIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function chatUploadPath(userId: string, uploadId: string) {
  return `${userId}/chat-uploads/${uploadId}`;
}
