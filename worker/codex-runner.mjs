import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_RESULT_LENGTH = 200_000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

const TEXT_ONLY_POLICY = `You are Relay's text-only task worker.
Use only the task text supplied below. Do not run commands, inspect files, use web search, call external tools, or claim actions outside the supplied context.
Return only a concise, useful Markdown result. State any limitation instead of claiming an action you could not perform.`;

export async function runWithCodex(input, options = {}) {
  const command = options.command || "codex";
  const timeoutMs = parseTimeout(options.timeoutMs);
  const workingDirectory = await mkdtemp(join(tmpdir(), "relay-codex-"));

  try {
    return await execute(command, codexArguments(options.model), `${TEXT_ONLY_POLICY}\n\n${input}`, {
      cwd: workingDirectory,
      env: codexEnvironment(options.env || process.env),
      timeoutMs,
    });
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

export function codexArguments(model) {
  const args = [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "--color",
    "never",
    "-c",
    'approval_policy="never"',
    "-c",
    'web_search="disabled"',
    "-c",
    'default_permissions="relay-text-only"',
    "-c",
    'permissions.relay-text-only.filesystem={":root"="deny", ":minimal"="read", ":workspace_roots"={"."="read"}}',
    "-c",
    "permissions.relay-text-only.network.enabled=false",
  ];
  if (model) args.push("--model", model);
  args.push("-");
  return args;
}

export function codexEnvironment(source) {
  const allowed = [
    "CODEX_CA_CERTIFICATE",
    "CODEX_HOME",
    "DBUS_SESSION_BUS_ADDRESS",
    "HOME",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "LOGNAME",
    "PATH",
    "SHELL",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USER",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_RUNTIME_DIR",
  ];
  return Object.fromEntries(allowed.filter((name) => source[name]).map((name) => [name, source[name]]));
}

async function execute(command, args, input, options) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error(`Codex CLI timed out after ${options.timeoutMs} milliseconds.`));
    }, options.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_RESULT_LENGTH) {
        child.kill("SIGTERM");
        finish(new Error("Codex CLI result exceeded Relay's 200,000-character limit."));
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 50_000) stderr += chunk;
    });
    child.on("error", (error) => {
      const message = error.code === "ENOENT"
        ? "Codex CLI is not installed or is unavailable at RELAY_CODEX_PATH."
        : "Codex CLI could not be started.";
      finish(new Error(message));
    });
    child.on("close", (code) => {
      if (code !== 0) return finish(new Error(codexFailure(stderr, code)));
      const result = stdout.trim();
      if (!result) return finish(new Error("Codex CLI returned an empty result."));
      finish(null, result);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    }
  });
}

function codexFailure(stderr, code) {
  const normalized = stderr.toLowerCase();
  if (normalized.includes("not logged in") || normalized.includes("login required")) {
    return "Codex CLI is not authenticated. Run `codex login` as the worker service user.";
  }
  if (normalized.includes("usage limit") || normalized.includes("rate limit") || normalized.includes("quota")) {
    return "Codex CLI usage limit reached. Check the signed-in ChatGPT workspace and try again later.";
  }
  return `Codex CLI exited with status ${code}. Run it interactively to inspect its diagnostics.`;
}

function parseTimeout(value) {
  const parsed = Number(value || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed < 1000) {
    throw new Error("RELAY_CODEX_TIMEOUT_MS must be a number of at least 1000 milliseconds.");
  }
  return parsed;
}
