import { createTaskRunner } from "./task-runner.mjs";

const relayUrl = required("RELAY_URL").replace(/\/$/, "");
const workerToken = required("RELAY_WORKER_TOKEN");
const pollInterval = Number(process.env.RELAY_POLL_INTERVAL_MS || 5000);
const taskRunner = createTaskRunner();

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

console.log(`Relay worker started with ${taskRunner.backend}; polling ${new URL(relayUrl).origin}`);

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

  const { run, task } = claimed;
  console.log(`Claimed run ${run.id} (attempt ${run.attempt})`);
  try {
    const input = [
      `# Task\n${task.title}`,
      `# Instructions and context\n${task.instructions}`,
      run.feedback ? `# Feedback on the previous attempt\n${run.feedback}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    const resultMarkdown = await taskRunner.run(input);

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
      console.error(`Could not report failure for ${run.id}: ${safeError(reportError)}`);
    }
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
  if (!response.ok) throw new Error(body.error || `Relay returned HTTP ${response.status}.`);
  return body;
}

function safeError(error) {
  return error instanceof Error ? error.message : "Unknown error";
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
