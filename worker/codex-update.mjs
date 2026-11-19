import { spawn } from "node:child_process";
import { access, readFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, isAbsolute, join, delimiter } from "node:path";
import { codexEnvironment } from "./codex-runner.mjs";

export const CODEX_UPDATE_INTERVAL_MS = 24 * 60 * 60_000;

export function createCodexAutoUpdater({
  env = process.env,
  now = Date.now,
  run = runUpdateCommand,
  strategy = codexInstallStrategy,
} = {}) {
  let nextCheckAt = 0;
  let checking = false;
  return async function checkForCodexUpdate({ activeRuns = 0 } = {}) {
    if (
      (env.RELAY_WORKER_BACKEND || "openai").toLowerCase() !== "codex" ||
      (env.RELAY_CODEX_AUTO_UPDATE || env.RELAY_WORKER_AUTO_UPDATE) !== "on"
    )
      return { status: "disabled" };
    if (activeRuns || checking) return { status: "busy" };
    if (now() < nextCheckAt) return { status: "not-due" };
    nextCheckAt = now() + CODEX_UPDATE_INTERVAL_MS;
    checking = true;
    const command = env.RELAY_CODEX_PATH || "codex";
    const environment = codexEnvironment(env);
    const options = { env: environment, cwd: "/", timeout: 10_000 };
    try {
      const before = version(await run(command, ["--version"], options));
      const install = await strategy(command, environment);
      if (install.kind === "unsupported")
        return {
          status: "unsupported",
          version: before,
          error:
            "Codex is installed in a local npm project. Update that installation manually.",
        };
      const updater = install.kind === "npm" ? "npm" : command;
      const args =
        install.kind === "npm"
          ? [
              "install",
              "--global",
              "--prefix",
              install.prefix,
              "@openai/codex@latest",
              "--ignore-scripts",
              "--no-audit",
              "--no-fund",
            ]
          : ["update"];
      await run(updater, args, { ...options, timeout: 10 * 60_000 });
      // Read the configured path again, not an arbitrary Codex on another PATH.
      const after = version(await run(command, ["--version"], options));
      return {
        status: before === after ? "current" : "updated",
        previousVersion: before,
        version: after,
      };
    } catch (error) {
      return { status: "error", error: updateError(error) };
    } finally {
      checking = false;
    }
  };
}

function version(result) {
  const value = result.stdout.match(/codex(?:-cli)?\s+(\d[\w.+-]*)/i)?.[1];
  if (!value)
    throw Object.assign(new Error("Invalid version"), {
      code: "INVALID_VERSION",
    });
  return value;
}

export async function codexInstallStrategy(command, env) {
  let executable;
  if (isAbsolute(command)) executable = await realpath(command);
  else {
    for (const directory of (env.PATH || "")
      .split(delimiter)
      .filter(isAbsolute)) {
      const path = join(directory, command);
      try {
        await access(path, constants.X_OK);
        executable = await realpath(path);
        break;
      } catch {
        /* Try the next command directory. */
      }
    }
  }
  if (!executable)
    throw Object.assign(new Error("Missing Codex"), { code: "ENOENT" });
  let directory = dirname(executable);
  for (let depth = 0; depth < 8; depth++) {
    let pkg;
    try {
      pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    } catch {
      /* A standalone binary has no npm package metadata. */
    }
    if (pkg?.name === "@openai/codex") {
      const modules = dirname(dirname(directory));
      if (
        basename(modules) === "node_modules" &&
        basename(dirname(modules)) === "lib"
      )
        return { kind: "npm", prefix: dirname(dirname(modules)) };
      return { kind: "unsupported" };
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return { kind: "native" };
}

function updateError(error) {
  if (error?.code === "TIMEOUT")
    return "Codex update timed out; it will be checked again at the next daily interval.";
  if (error?.code === "ENOENT")
    return "Codex or npm was not found on the worker's configured command path.";
  if (error?.code === "EACCES")
    return "The worker service user cannot execute the Codex updater.";
  if (error?.code === "INVALID_VERSION")
    return "The configured Codex executable did not return a valid version. Run npm run worker:doctor.";
  const text = `${error?.stdout || ""}\n${error?.stderr || ""}`.toLowerCase();
  if (/eacces|permission denied|read-only file system/.test(text))
    return "Codex update could not write the installation. Update it as its owning user; Relay does not use sudo.";
  if (
    /unrecognized subcommand|unknown (?:command|subcommand)|debug builds|could not detect.*installation/.test(
      text,
    )
  )
    return "This Codex installation does not support automatic updating. Update the configured executable manually.";
  return "Codex update failed. Check the worker network and installation; it will be checked again at the next daily interval.";
}

// Isolate the updater so a timeout terminates npm/install subprocesses too.
// stdin is closed: an installer can never wait for an interactive password.
export function runUpdateCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, options.timeout);
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk).slice(-16_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-16_000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut || code !== 0)
        reject(
          Object.assign(new Error("Codex update command failed"), {
            code: timedOut ? "TIMEOUT" : code,
            stdout,
            stderr,
          }),
        );
      else resolve({ stdout, stderr });
    });
  });
}
