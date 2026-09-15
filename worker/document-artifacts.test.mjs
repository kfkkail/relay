import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changedDocuments, documentSnapshot } from "./document-artifacts.mjs";

describe("document artifacts", () => {
  it("returns new and updated text documents but ignores source and dependency files", async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-documents-"));
    await writeFile(join(root, "existing.md"), "before");
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "node_modules", "ignored.md"), "ignored");
    const before = await documentSnapshot(root);

    await writeFile(join(root, "existing.md"), "updated content");
    await writeFile(join(root, "result.txt"), "new document");
    await writeFile(join(root, "source.ts"), "export {};");

    await expect(changedDocuments(root, before)).resolves.toEqual([
      { type: "file", label: "existing.md", value: "updated content" },
      { type: "file", label: "result.txt", value: "new document" },
    ]);
  });
});
