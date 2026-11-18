import { runNhtsaBackfill } from "../worker/vehicles/nhtsa-backfill.mjs";

const url = process.env.RELAY_URL;
const token = process.env.RELAY_WORKER_TOKEN;
if (!url || !token)
  throw new Error(
    "Load the worker environment containing RELAY_URL and RELAY_WORKER_TOKEN.",
  );
const origin = new URL(url);
if (origin.protocol !== "https:" || origin.username || origin.password)
  throw new Error("RELAY_URL must be an HTTPS origin.");
const result = await runNhtsaBackfill(
  async (path, init) => {
    const response = await fetch(new URL(path, origin), {
      ...init,
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok)
      throw new Error(
        `Relay NHTSA backfill returned HTTP ${response.status}. Deploy the migration and API first.`,
      );
    return response.json();
  },
  { onProgress: (counts) => console.log(`NHTSA ${JSON.stringify(counts)}`) },
);
if (result.failed) process.exitCode = 1;
