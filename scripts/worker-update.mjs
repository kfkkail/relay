import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAutoUpdater } from "../worker/auto-update.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const update = createAutoUpdater({ root, enabled: true });
const result = await update({ force: true });

if (result.status === "updated") {
  console.log(`Relay worker updated to ${result.revision}.`);
  process.exit(0);
}
if (result.status === "current") {
  console.log("Relay worker is already current.");
  process.exit(0);
}
console.error(
  `Relay worker update did not complete (${result.status})${result.error ? `: ${result.error}` : ""}.`,
);
process.exit(1);
