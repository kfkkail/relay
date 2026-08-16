import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = process.env.RELAY_CONTAINER_RUNTIME || findExecutable("docker");
const image = process.env.RELAY_CODEX_IMAGE || "relay-codex-worker:local";
const codexVersion = process.env.RELAY_CODEX_VERSION || "0.147.0";

const result = spawnSync(runtime, [
  "build",
  "--build-arg",
  `CODEX_VERSION=${codexVersion}`,
  "--tag",
  image,
  join(root, "worker/container"),
], {
  cwd: root,
  stdio: "inherit",
});

if (result.error || result.status !== 0) {
  console.error("\nWorker image build failed. Confirm the container runtime is installed and running.");
  process.exit(result.status || 1);
}

console.log(`\nBuilt ${image} with Codex CLI ${codexVersion}.`);

function findExecutable(name) {
  if (isAbsolute(name)) return name;
  for (const directory of (process.env.PATH || "").split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next PATH entry.
    }
  }
  return name;
}
