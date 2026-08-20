import { basename, extname } from "node:path";
import { ApiError } from "@/lib/http";

export const MAX_DOCUMENTS = 10;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_TOTAL_BYTES = 25 * 1024 * 1024;

const documentTypes: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".pdf": "application/pdf",
  ".csv": "text/csv",
  ".json": "application/json",
};

export function safeDocumentFilename(value: string) {
  const original = basename(value).normalize("NFKC");
  const extension = extname(original).toLowerCase();
  const stem = original.slice(0, -extension.length || undefined);
  const safeStem =
    stem
      .replace(/[\u0000-\u001f\u007f/\\]/g, "-")
      .replace(/[^\p{L}\p{N}._ -]/gu, "-")
      .replace(/[. ]+$/g, "")
      .slice(0, 180) || "document";
  return `${safeStem}${extension}`.slice(0, 200);
}

export function validateDocumentBytes(filename: string, bytes: Buffer) {
  const extension = extname(filename).toLowerCase();
  const mimeType = documentTypes[extension];
  if (!mimeType) throw new ApiError("Unsupported document type.");
  if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES)
    throw new ApiError("Document must be between 1 byte and 10 MB.");
  if (extension === ".pdf") {
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
      throw new ApiError("Document content does not match its PDF extension.");
  } else {
    const text = bytes.toString("utf8");
    if (text.includes("\u0000") || Buffer.from(text).compare(bytes) !== 0)
      throw new ApiError("Text document is not valid UTF-8.");
    if (extension === ".json") {
      try {
        JSON.parse(text);
      } catch {
        throw new ApiError("JSON document is invalid.");
      }
    }
  }
  return { mimeType, displayFilename: safeDocumentFilename(filename) };
}
