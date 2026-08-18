import sharp from "sharp";
import { ApiError } from "@/lib/http";

export const ATTACHMENT_BUCKET = "task-attachments";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_DIMENSION = 12_000;
export const MAX_ATTACHMENT_PIXELS = 40_000_000;
export const attachmentMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export type AttachmentMimeType = (typeof attachmentMimeTypes)[number];

export function validateAttachmentRequest(fileName: unknown, mimeType: unknown, byteSize: unknown) {
  const safeName = typeof fileName === "string" ? fileName.trim().slice(0, 255) : "";
  const size = Number(byteSize);
  if (!safeName) throw new ApiError("Image filename is required.");
  if (!attachmentMimeTypes.includes(mimeType as AttachmentMimeType)) {
    throw new ApiError("Images must be JPEG, PNG, or WebP.");
  }
  if (!Number.isInteger(size) || size < 1 || size > MAX_ATTACHMENT_BYTES) {
    throw new ApiError("Images must be 10 MB or smaller.");
  }
  return { fileName: safeName, mimeType: mimeType as AttachmentMimeType, byteSize: size };
}

export async function normalizeImage(input: Buffer, declaredType: AttachmentMimeType) {
  if (input.byteLength > MAX_ATTACHMENT_BYTES) throw new ApiError("Image is larger than 10 MB.");
  let metadata;
  try {
    metadata = await sharp(input, { limitInputPixels: MAX_ATTACHMENT_PIXELS }).metadata();
  } catch {
    throw new ApiError("The uploaded file is not a valid supported image.");
  }
  const detectedType = metadata.format === "jpeg" ? "image/jpeg" : metadata.format === "png" ? "image/png" : metadata.format === "webp" ? "image/webp" : null;
  if (!detectedType || detectedType !== declaredType) throw new ApiError("The image contents do not match its declared type.");
  if (!metadata.width || !metadata.height || metadata.width > MAX_ATTACHMENT_DIMENSION || metadata.height > MAX_ATTACHMENT_DIMENSION || metadata.width * metadata.height > MAX_ATTACHMENT_PIXELS) {
    throw new ApiError("Image dimensions are too large.");
  }
  const pipeline = sharp(input, { limitInputPixels: MAX_ATTACHMENT_PIXELS }).rotate();
  const data = detectedType === "image/jpeg"
    ? await pipeline.jpeg().toBuffer()
    : detectedType === "image/png"
      ? await pipeline.png().toBuffer()
      : await pipeline.webp().toBuffer();
  if (data.byteLength > MAX_ATTACHMENT_BYTES) throw new ApiError("Normalized image is larger than 10 MB.");
  const normalized = await sharp(data).metadata();
  return { data, mimeType: detectedType as AttachmentMimeType, width: normalized.width!, height: normalized.height! };
}
