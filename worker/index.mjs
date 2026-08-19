import { createTaskRunner } from "./task-runner.mjs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const relayUrl = required("RELAY_URL").replace(/\/$/, "");
const workerToken = required("RELAY_WORKER_TOKEN");
const pollInterval = Number(process.env.RELAY_POLL_INTERVAL_MS || 5000);
const taskRunner = createTaskRunner();

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

console.log(
  `Relay worker started with ${taskRunner.backend}; polling ${new URL(relayUrl).origin}`,
);

while (!stopping) {
  let claimed;
  try {
    claimed = await relayRequest("/api/worker/runs/claim", { method: "POST" });
  } catch (error) {
    console.error(`Claim failed: ${safeError(error)}`);
    await sleep(pollInterval);
    continue;
  }

  if (!claimed) {
    await sleep(pollInterval);
    continue;
  }

  const { run, task, attachments = [] } = claimed;
  console.log(`Claimed run ${run.id} (attempt ${run.attempt})`);
  let attachmentDirectory;
  try {
    const localAttachments = [];
    if (attachments.length) {
      attachmentDirectory = await mkdtemp(join(tmpdir(), `relay-${run.id}-`));
      for (const attachment of attachments) {
        const extension =
          attachment.mime_type === "image/jpeg"
            ? ".jpg"
            : attachment.mime_type === "image/png"
              ? ".png"
              : ".webp";
        const path = join(attachmentDirectory, `${attachment.id}${extension}`);
        const data = await relayDownload(
          `/api/worker/runs/${run.id}/attachments/${attachment.id}`,
        );
        if (data.byteLength !== attachment.byte_size)
          throw new Error(
            `Attachment ${attachment.file_name} did not match its recorded size.`,
          );
        await writeFile(path, data, { flag: "wx" });
        localAttachments.push({
          path,
          mimeType: attachment.mime_type,
          fileName: attachment.file_name,
        });
      }
    }
    const input = [
      `# Task\n${task.title}`,
      `# Instructions and context\n${task.instructions}`,
      run.feedback
        ? `# Feedback on the previous attempt\n${run.feedback}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    const attachmentNote = localAttachments.length
      ? `\n\n# Attached images\n${localAttachments.map((item) => `- ${item.fileName}`).join("\n")}`
      : "";
    const resultMarkdown = await taskRunner.run({
      text: input + attachmentNote,
      attachments: localAttachments,
    });

    await relayRequest(`/api/worker/runs/${run.id}/complete`, {
      method: "POST",
      body: JSON.stringify({ resultMarkdown, artifacts: [] }),
    });
    console.log(`Completed run ${run.id}`);
  } catch (error) {
    const message = safeError(error);
    console.error(`Run ${run.id} failed: ${message}`);
    try {
      await relayRequest(`/api/worker/runs/${run.id}/fail`, {
        method: "POST",
        body: JSON.stringify({ error: message }),
      });
    } catch (reportError) {
      console.error(
        `Could not report failure for ${run.id}: ${safeError(reportError)}`,
      );
    }
  } finally {
    if (attachmentDirectory)
      await rm(attachmentDirectory, { recursive: true, force: true });
  }
}

console.log("Relay worker stopped");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function relayRequest(path, init) {
  const response = await fetch(`${relayUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${workerToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || `Relay returned HTTP ${response.status}.`);
  return body;
}

async function relayDownload(path) {
  const response = await fetch(`${relayUrl}${path}`, {
    headers: { Authorization: `Bearer ${workerToken}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.error ||
        `Relay could not download an attachment (HTTP ${response.status}).`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

function safeError(error) {
  return error instanceof Error ? error.message : "Unknown error";
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
