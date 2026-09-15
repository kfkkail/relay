import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const documentExtensions = new Set([".md", ".markdown", ".txt"]);
const ignoredDirectories = new Set([".git", ".next", "node_modules", "dist", "build", "coverage"]);

export async function documentSnapshot(root) {
  const snapshot = new Map();
  await visitDocuments(root, async (path, relativePath) => {
    const info = await stat(path);
    snapshot.set(relativePath, `${info.mtimeMs}:${info.size}`);
  });
  return snapshot;
}

export async function changedDocuments(root, before) {
  const artifacts = [];
  let totalCharacters = 0;
  await visitDocuments(root, async (path, relativePath) => {
    if (artifacts.length >= 10 || totalCharacters >= 100_000) return;
    const info = await stat(path);
    if (before.get(relativePath) === `${info.mtimeMs}:${info.size}`) return;
    const content = await readFile(path, "utf8");
    if (!content.trim()) return;
    const value = content.slice(0, 100_000 - totalCharacters);
    totalCharacters += value.length;
    artifacts.push({ type: "file", label: relativePath, value });
  });
  return artifacts;
}

async function visitDocuments(root, visitor, relativeDirectory = "") {
  let entries;
  try {
    entries = await readdir(join(root, relativeDirectory), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const relativePath = join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) await visitDocuments(root, visitor, relativePath);
      continue;
    }
    const extension = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
    if (entry.isFile() && documentExtensions.has(extension)) await visitor(join(root, relativePath), relativePath);
  }
}
