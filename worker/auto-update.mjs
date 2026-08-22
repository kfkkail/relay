import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const DEFAULT_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

export function createAutoUpdater({
  root,
  enabled = process.env.RELAY_WORKER_AUTO_UPDATE === "on",
  intervalMs = Number(
    process.env.RELAY_WORKER_UPDATE_INTERVAL_MS || DEFAULT_UPDATE_INTERVAL_MS,
  ),
  run = runCommand,
  now = Date.now,
} = {}) {
  let nextCheckAt = 0;

  return async function checkForUpdate({ force = false } = {}) {
    if (!enabled) return { status: "disabled" };
    if (!force && now() < nextCheckAt) return { status: "not-due" };
    nextCheckAt = now() + intervalMs;

    try {
      return await updateManagedClone(root, run);
    } catch (error) {
      return { status: "error", error: safeError(error) };
    }
  };
}

export async function updateManagedClone(root, run = runCommand) {
  const pendingPath = `${root}/.relay/update-pending`;
  const pending = await exists(pendingPath);

  if (!pending) {
    const dirty = await run("git", ["status", "--porcelain"], { cwd: root });
    if (dirty.stdout.trim()) return { status: "dirty" };

    await run("git", ["fetch", "--quiet", "origin", "main"], { cwd: root });
    const local = await revision(run, root, "HEAD");
    const remote = await revision(run, root, "origin/main");
    if (local === remote) return { status: "current", revision: local };

    try {
      await run("git", ["merge-base", "--is-ancestor", "HEAD", "origin/main"], {
        cwd: root,
      });
    } catch {
      return { status: "diverged" };
    }

    const lockBefore = await readFile(`${root}/package-lock.json`, "utf8");
    await run("git", ["merge", "--ff-only", "origin/main"], { cwd: root });
    const lockAfter = await readFile(`${root}/package-lock.json`, "utf8");
    await mkdir(`${root}/.relay`, { recursive: true });
    await writeFile(
      pendingPath,
      JSON.stringify({ dependenciesChanged: lockBefore !== lockAfter }),
    );
  }

  const state = JSON.parse(await readFile(pendingPath, "utf8"));
  if (state.dependenciesChanged) {
    await run("npm", ["ci", "--omit=dev", "--ignore-scripts"], { cwd: root });
  }
  await run(process.execPath, ["--check", `${root}/worker/index.mjs`], {
    cwd: root,
  });
  await rm(pendingPath);
  return { status: "updated", revision: await revision(run, root, "HEAD") };
}

async function revision(run, root, name) {
  const result = await run("git", ["rev-parse", name], { cwd: root });
  return result.stdout.trim();
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function runCommand(executable, args, options) {
  return execFile(executable, args, { ...options, timeout: 60_000 });
}

function safeError(error) {
  return error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
}
