import { ApiError } from "@/lib/http";
import { normalizeImage, validateAttachmentRequest } from "@/lib/attachments";
import { noteImageIds, noteImageLimit } from "@/lib/owner-action-note-media";

export async function prepareNoteImages(notes: string, input: unknown) {
  if (input === undefined) return {};
  if (!Array.isArray(input) || input.length > 10)
    throw new ApiError("Add up to 10 images per save.");

  const ids = new Set(noteImageIds(notes));
  const images: Record<string, { mimeType: string; data: string }> = {};
  let inputBytes = 0;
  let outputBytes = 0;
  for (const image of input) {
    if (
      !ids.has(image?.id) ||
      image.id in images ||
      typeof image.data !== "string"
    )
      throw new ApiError("Invalid note image.");
    if (image.data.length > Math.ceil(noteImageLimit / 3) * 4)
      throw new ApiError("Selected images must total 3 MB or less per save.");
    const buffer = Buffer.from(image.data, "base64");
    inputBytes += buffer.length;
    if (inputBytes > noteImageLimit)
      throw new ApiError("Selected images must total 3 MB or less per save.");
    const { mimeType } = validateAttachmentRequest(
      "Note image",
      image.mimeType,
      buffer.length,
    );
    const normalized = await normalizeImage(buffer, mimeType).catch(() => {
      throw new ApiError("Could not process the selected image.");
    });
    outputBytes += normalized.data.length;
    if (outputBytes > noteImageLimit)
      throw new ApiError("Processed images must total 3 MB or less per save.");
    images[image.id] = { mimeType, data: normalized.data.toString("base64") };
  }
  return images;
}
