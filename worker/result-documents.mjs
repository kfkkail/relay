import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";

export const MAX_DOCUMENTS = 10;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_TOTAL_BYTES = 25 * 1024 * 1024;
const types = new Map([
  [".md", "text/markdown"],
  [".txt", "text/plain"],
  [".pdf", "application/pdf"],
  [".csv", "text/csv"],
  [".json", "application/json"],
]);

export async function collectResultDocuments(workspace, declarations) {
  if (!Array.isArray(declarations) || declarations.length > MAX_DOCUMENTS)
    throw new Error("Codex may declare at most 10 result documents.");
  const root = await realpath(workspace);
  let total = 0;
  const documents = [];
  for (const declaration of declarations) {
    if (!declaration || typeof declaration.path !== "string")
      throw new Error("Each result document needs a relative path.");
    if (declaration.path.includes("\u0000"))
      throw new Error("Result document path is invalid.");
    const candidate = resolve(root, declaration.path);
    const lexical = relative(root, candidate);
    if (lexical === ".." || lexical.startsWith(`..${sep}`))
      throw new Error("Result document path leaves the configured workspace.");
    const info = await lstat(candidate);
    if (info.isSymbolicLink() || !info.isFile())
      throw new Error(
        "Result documents must be regular files, not symlinks or directories.",
      );
    const resolved = await realpath(candidate);
    const contained = relative(root, resolved);
    if (contained === ".." || contained.startsWith(`..${sep}`))
      throw new Error(
        "Result document resolves outside the configured workspace.",
      );
    const extension = extname(candidate).toLowerCase();
    const mimeType = types.get(extension);
    if (!mimeType)
      throw new Error(
        `Unsupported result document type: ${extension || "none"}.`,
      );
    if (!info.size || info.size > MAX_DOCUMENT_BYTES)
      throw new Error("Each result document must be between 1 byte and 10 MB.");
    total += info.size;
    if (total > MAX_DOCUMENT_TOTAL_BYTES)
      throw new Error("Result documents may total at most 25 MB.");
    const bytes = await readFile(resolved);
    validateContent(extension, bytes);
    documents.push({
      path: resolved,
      fileName: basename(candidate),
      mimeType,
      byteSize: info.size,
      description:
        typeof declaration.description === "string"
          ? declaration.description.slice(0, 500)
          : undefined,
    });
  }
  return documents;
}

function validateContent(extension, bytes) {
  if (extension === ".pdf") {
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
      throw new Error("A declared PDF does not contain a PDF header.");
    return;
  }
  const text = bytes.toString("utf8");
  if (text.includes("\u0000") || Buffer.from(text).compare(bytes) !== 0)
    throw new Error("A declared text document is not valid UTF-8.");
  if (extension === ".json") {
    try {
      JSON.parse(text);
    } catch {
      throw new Error("A declared JSON document is invalid.");
    }
  }
}

export function parseCodexResult(output) {
  let value;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error("Codex CLI did not return Relay's structured result JSON.");
  }
  if (
    !value ||
    typeof value.resultMarkdown !== "string" ||
    !value.resultMarkdown.trim() ||
    !Array.isArray(value.documents)
  )
    throw new Error("Codex CLI returned an invalid structured result.");
  return {
    resultMarkdown: value.resultMarkdown.trim(),
    documents: value.documents,
  };
}
