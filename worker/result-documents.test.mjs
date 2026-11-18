import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateDocumentBytes } from "../lib/result-documents.ts";
import {
  collectResultDocuments,
  parseCodexResult,
} from "./result-documents.mjs";

const directories = [];
afterEach(async () =>
  Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "relay-docs-"));
  directories.push(path);
  return path;
}

describe("result documents", () => {
  it("passes a calendar file from worker collection through upload validation", async () => {
    const workspace = await directory();
    const bytes = Buffer.from(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Relay//Calendar//EN",
        "BEGIN:VEVENT",
        "UID:deadline-20260918@relay",
        "DTSTAMP:20260917T120000Z",
        "DTSTART;VALUE=DATE:20260918",
        "DTEND;VALUE=DATE:20260919",
        "SUMMARY:Deadline",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
    await writeFile(join(workspace, "deadline.ics"), bytes);
    const [document] = await collectResultDocuments(workspace, [
      { path: "deadline.ics" },
    ]);
    expect(document.mimeType).toBe("text/calendar");
    expect(validateDocumentBytes(document.fileName, bytes)).toEqual({
      mimeType: document.mimeType,
      displayFilename: "deadline.ics",
    });
    const invalid = Buffer.from([0xff, 0x00]);
    await writeFile(join(workspace, "invalid.ics"), invalid);
    await expect(
      collectResultDocuments(workspace, [{ path: "invalid.ics" }]),
    ).rejects.toThrow("UTF-8");
    expect(() => validateDocumentBytes("invalid.ics", invalid)).toThrow(
      "UTF-8",
    );
  });
  it("accepts supported workspace files", async () => {
    const workspace = await directory();
    await writeFile(join(workspace, "report.md"), "# Report\n");
    await expect(
      collectResultDocuments(workspace, [{ path: "report.md" }]),
    ).resolves.toMatchObject([
      { fileName: "report.md", mimeType: "text/markdown" },
    ]);
  });
  it("rejects path traversal", async () => {
    const workspace = await directory();
    await expect(
      collectResultDocuments(workspace, [{ path: "../secret.txt" }]),
    ).rejects.toThrow("leaves the configured workspace");
  });
  it("rejects symlinks", async () => {
    const workspace = await directory();
    const target = join(await directory(), "secret.txt");
    await writeFile(target, "secret");
    await symlink(target, join(workspace, "report.txt"));
    await expect(
      collectResultDocuments(workspace, [{ path: "report.txt" }]),
    ).rejects.toThrow("not symlinks");
  });
  it("rejects spoofed PDFs and invalid JSON", async () => {
    const workspace = await directory();
    await writeFile(join(workspace, "fake.pdf"), "not pdf");
    await writeFile(join(workspace, "bad.json"), "{");
    await expect(
      collectResultDocuments(workspace, [{ path: "fake.pdf" }]),
    ).rejects.toThrow("PDF header");
    await expect(
      collectResultDocuments(workspace, [{ path: "bad.json" }]),
    ).rejects.toThrow("invalid");
  });
  it("parses the structured Codex response", () => {
    expect(
      parseCodexResult(
        '{"resultMarkdown":"Summary","documents":[{"path":"report.md"}]}',
      ),
    ).toEqual({
      resultMarkdown: "Summary",
      documents: [{ path: "report.md" }],
    });
  });
});
