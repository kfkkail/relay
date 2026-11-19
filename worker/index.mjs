import { CHAT_CONTRACT } from "./chat-contract.mjs";
import { createTaskRunner } from "./task-runner.mjs";
import { runVehicleJob, vehicleCapabilities } from "./vehicles/handler.mjs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectResultDocuments } from "./result-documents.mjs";
import deliverables from "../lib/deliverables.json" with { type: "json" };
import {
  DEFAULT_MAX_CONCURRENT_RUNS,
  fillAvailableSlots,
  nextIdlePollInterval,
} from "./run-scheduler.mjs";
import { createAutoUpdater } from "./auto-update.mjs";
import { createCodexAutoUpdater } from "./codex-update.mjs";
import {
  renewRunHeartbeat,
  startRunHeartbeat,
  validateHeartbeatInterval,
} from "./run-heartbeat.mjs";
import { createRelayClient } from "./relay-client.mjs";
import { createWakeSignal, listenForWakeups } from "./wakeup.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const relayUrl = required("RELAY_URL").replace(/\/$/, "");
const workerToken = required("RELAY_WORKER_TOKEN");
const { request: relayRequest, download: relayDownload } = createRelayClient({
  relayUrl,
  workerToken,
});
const pollInterval = Number(process.env.RELAY_POLL_INTERVAL_MS || 5000);
const maxIdlePollInterval = Number(
  process.env.RELAY_MAX_IDLE_POLL_INTERVAL_MS || 60000,
);
const runHeartbeatInterval = Number(
  process.env.RELAY_RUN_HEARTBEAT_INTERVAL_MS || 30000,
);
validateHeartbeatInterval(runHeartbeatInterval);
const taskRunner = createTaskRunner();
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkForUpdate = createAutoUpdater({ root });
const checkForCodexUpdate = createCodexAutoUpdater();

let stopping = false;
const wake = createWakeSignal();
const wakeConnection = new AbortController();
function stop() {
  stopping = true;
  wakeConnection.abort();
  wake.notify();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const wakeListener = listenForWakeups({
  request: relayRequest,
  notify: wake.notify,
  signal: wakeConnection.signal,
}).catch(() => {
  if (!stopping)
    console.warn("Worker wake-up listener stopped. Polling remains available.");
});

console.log(
  `Relay worker started with ${taskRunner.backend}; polling ${new URL(relayUrl).origin}; running up to ${DEFAULT_MAX_CONCURRENT_RUNS} agents`,
);

const activeRuns = new Set();
let idlePollInterval = pollInterval;
while (!stopping) {
  wake.clear();
  let claimedRuns = 0;
  try {
    claimedRuns = await fillAvailableSlots({
      activeRuns,
      claim: () =>
        relayRequest("/api/worker/runs/claim", {
          method: "POST",
          body: JSON.stringify({
            capabilities: vehicleCapabilities(),
            chat: true,
          }),
        }),
      run: processClaimedRun,
      onSettled: wake.notify,
    });
  } catch (error) {
    console.error(`Claim failed: ${safeError(error)}`);
  }

  if (!activeRuns.size && !wake.pending && !stopping) {
    const update = await checkForUpdate();
    if (update.status === "updated") {
      console.log(`Worker updated to ${update.revision}; restarting`);
      process.exit(0);
    }
    if (["dirty", "diverged", "error"].includes(update.status)) {
      console.error(
        `Worker update skipped (${update.status})${update.error ? `: ${update.error}` : ""}`,
      );
    }
    if (stopping) break;
    if (wake.pending) continue;
    const codexUpdate = await checkForCodexUpdate({
      activeRuns: activeRuns.size,
    });
    if (["updated", "current"].includes(codexUpdate.status))
      console.log(
        `Codex update check: ${codexUpdate.status} (${codexUpdate.version})`,
      );
    else if (["error", "unsupported"].includes(codexUpdate.status))
      console.error(`Codex update skipped: ${codexUpdate.error}`);
  }
  if (stopping) break;

  if (claimedRuns > 0) idlePollInterval = pollInterval;

  if (!activeRuns.size) {
    await wake.wait(idlePollInterval);
    idlePollInterval = nextIdlePollInterval(idlePollInterval, {
      baseInterval: pollInterval,
      maxInterval: maxIdlePollInterval,
    });
    continue;
  }

  await wake.wait(pollInterval);
}

await Promise.allSettled([wakeListener, ...activeRuns]);
console.log("Relay worker stopped");

async function processClaimedRun(claimed) {
  const { run, task, attachments = [] } = claimed;
  console.log(`Claimed run ${run.id} (attempt ${run.attempt})`);
  let attachmentDirectory;
  let heartbeat;
  let signal;
  try {
    if (run.job_kind !== "vehicle_search") {
      // Verify the renewal path before starting work that may mutate external systems.
      heartbeat = startRunHeartbeat({
        intervalMs: runHeartbeatInterval,
        heartbeat: (signal) => renewRunHeartbeat(relayRequest, run.id, signal),
        onError: (error) =>
          console.error(`Heartbeat failed for ${run.id}: ${safeError(error)}`),
        onRecovered: () => console.log(`Heartbeat recovered for ${run.id}`),
      });
      signal = heartbeat.signal;
      await heartbeat.ready;
      signal.throwIfAborted();
    }
    if (run.job_kind === "vehicle_search") {
      const result = await runVehicleJob(claimed, relayRequest);
      if (result?.enrichment_failed) return;
      console.log(`Completed vehicle run ${run.id}`);
      return;
    }
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
          { signal },
        );
        if (data.byteLength !== attachment.byte_size)
          throw new Error(
            `Attachment ${attachment.file_name} did not match its recorded size.`,
          );
        await writeFile(path, data, { flag: "wx", signal });
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
    const definition = deliverables[task.deliverable];
    if (!definition)
      throw new Error(
        `Relay returned an unsupported deliverable: ${task.deliverable}`,
      );
    const result = await taskRunner.run(
      {
        text: input + attachmentNote,
        attachments: localAttachments,
      },
      task.conversation ? CHAT_CONTRACT : definition.contract,
      { signal },
    );

    signal?.throwIfAborted();

    const documents =
      taskRunner.backend === "codex"
        ? await collectResultDocuments(
            process.env.RELAY_CODEX_WORKSPACE,
            result.documents,
          )
        : [];
    const documentIds = [];
    for (const document of documents) {
      signal?.throwIfAborted();
      const form = new FormData();
      form.set(
        "file",
        new File(
          [await readFile(document.path, { signal })],
          document.fileName,
          {
            type: document.mimeType,
          },
        ),
      );
      if (document.description) form.set("description", document.description);
      const uploaded = await relayRequest(
        `/api/worker/runs/${run.id}/documents`,
        { method: "POST", body: form, signal },
      );
      documentIds.push(uploaded.document.id);
    }
    signal?.throwIfAborted();
    // Allow this bounded terminal request to settle: a concurrent heartbeat can
    // return 404 after completion has already committed successfully.
    await relayRequest(`/api/worker/runs/${run.id}/complete`, {
      method: "POST",
      body: JSON.stringify({
        resultMarkdown: result.resultMarkdown,
        artifacts: [],
        documentIds,
      }),
    });
    console.log(`Completed run ${run.id}`);
  } catch (error) {
    const message = safeError(signal?.aborted ? signal.reason : error);
    console.error(`Run ${run.id} failed: ${message}`);
    try {
      await relayRequest(`/api/worker/runs/${run.id}/fail`, {
        method: "POST",
        body: JSON.stringify({ error: message, lease: run.lease }),
      });
    } catch (reportError) {
      console.error(
        `Could not report failure for ${run.id}: ${safeError(reportError)}`,
      );
    }
  } finally {
    await heartbeat?.stop();
    if (attachmentDirectory)
      await rm(attachmentDirectory, { recursive: true, force: true });
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function safeError(error) {
  return error instanceof Error ? error.message : "Unknown error";
}
