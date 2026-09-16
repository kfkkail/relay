import { execFileSync } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { constants } from "node:fs";
import { parseEnv } from "node:util";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let root = sourceRoot;
let workerEnvContents = "";
const command = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
const label = "com.relay.worker";
let envPath = join(root, ".env.worker");
let workerPath = join(root, "worker/index.mjs");

if (
  !command ||
  process.argv.includes("--help") ||
  process.argv.includes("-h")
) {
  printHelp();
  process.exit(command ? 0 : 1);
}

if (!new Set(["install", "status", "uninstall"]).has(command)) {
  fail(`Unknown command: ${command}.`);
}

if (!["darwin", "linux"].includes(process.platform)) {
  fail(`Background services are not yet supported on ${process.platform}.`);
}

if (command === "install" && !dryRun) {
  if (Number(process.versions.node.split(".")[0]) < 22) {
    fail(
      `Relay requires Node.js 22 or newer; found ${process.version}. Upgrade Node.js and retry installation.`,
    );
  }
  console.log("Checking worker configuration and service prerequisites...");
  await ensureWorkerEnv();
  commandOutput("git", ["--version"]);
  commandOutput("npm", ["--version"]);
  if (process.platform === "linux") {
    commandOutput("systemctl", ["--user", "show-environment"]);
    ensureSystemdLinger(userInfo().username);
  }
  root = await prepareManagedInstall();
  envPath = join(root, ".env.worker");
  workerPath = join(root, "worker/index.mjs");
}

if (process.platform === "darwin") {
  await manageLaunchd(command);
} else if (process.platform === "linux") {
  await manageSystemd(command);
} else {
  fail(`Background services are not yet supported on ${process.platform}.`);
}

async function manageLaunchd(action) {
  const directory = join(homedir(), "Library/LaunchAgents");
  const servicePath = join(directory, `${label}.plist`);
  const domain = `gui/${process.getuid()}`;
  const service = `${domain}/${label}`;

  if (action === "install") {
    const logs = join(root, ".relay");
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>--env-file=${xml(envPath)}</string>
    <string>${xml(workerPath)}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key>
  <dict><key>RELAY_WORKER_AUTO_UPDATE</key><string>${autoUpdateSetting()}</string></dict>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${xml(join(logs, "worker.stdout.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logs, "worker.stderr.log"))}</string>
</dict>
</plist>
`;
    if (dryRun) return showDryRun(servicePath);
    await mkdir(directory, { recursive: true });
    await mkdir(logs, { recursive: true });
    runAllowFailure("launchctl", ["bootout", domain, servicePath]);
    await writeFile(servicePath, plist, { mode: 0o644 });
    run("launchctl", ["bootstrap", domain, servicePath]);
    run("launchctl", ["enable", service]);
    run("launchctl", ["kickstart", "-k", service]);
    console.log(`Relay worker installed and started (${label}).`);
    console.log(`Logs: ${logs}`);
    return;
  }

  if (action === "status") {
    run("launchctl", ["print", service], true);
    return;
  }

  if (dryRun) return showDryRun(servicePath);
  runAllowFailure("launchctl", ["bootout", domain, servicePath]);
  await removeIfPresent(servicePath);
  console.log(
    "Relay worker service removed. Worker logs were kept in .relay/.",
  );
}

async function manageSystemd(action) {
  const directory = join(homedir(), ".config/systemd/user");
  const servicePath = join(directory, "relay-worker.service");
  const username = userInfo().username;

  if (action === "install") {
    const unit = `[Unit]
Description=Relay worker
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemdPath(root)}
ExecStart=${systemdQuote(process.execPath)} ${systemdQuote(`--env-file=${envPath}`)} ${systemdQuote(workerPath)}
Restart=always
RestartSec=5
Environment=RELAY_WORKER_AUTO_UPDATE=${autoUpdateSetting()}

[Install]
WantedBy=default.target
`;
    if (dryRun) return showDryRun(servicePath);
    await mkdir(directory, { recursive: true });
    await writeFile(servicePath, unit, { mode: 0o644 });
    run("systemctl", ["--user", "daemon-reload"]);
    run("systemctl", ["--user", "enable", "--now", "relay-worker.service"]);
    run("systemctl", [
      "--user",
      "is-active",
      "--quiet",
      "relay-worker.service",
    ]);
    console.log(
      "Relay worker installed and started as a systemd user service.",
    );
    console.log(
      "It will continue after logout and start automatically at boot.",
    );
    return;
  }

  if (action === "status") {
    console.log(
      `Start after logout/boot: ${isSystemdLingerEnabled(username) ? "enabled" : "disabled"}`,
    );
    run(
      "systemctl",
      ["--user", "--no-pager", "--full", "status", "relay-worker.service"],
      true,
    );
    return;
  }

  if (dryRun) return showDryRun(servicePath);
  runAllowFailure("systemctl", [
    "--user",
    "disable",
    "--now",
    "relay-worker.service",
  ]);
  await removeIfPresent(servicePath);
  run("systemctl", ["--user", "daemon-reload"]);
  console.log("Relay worker service removed.");
}

function ensureSystemdLinger(username) {
  if (isSystemdLingerEnabled(username)) return;

  console.log(
    "Enabling the systemd user service to continue after logout and start at boot...",
  );
  if (process.getuid() === 0) {
    run("loginctl", ["enable-linger", username], true);
  } else {
    if (!process.stdin.isTTY) {
      fail(
        `Systemd lingering is disabled. Run sudo loginctl enable-linger ${username}, then retry installation.`,
      );
    }
    run("sudo", ["loginctl", "enable-linger", username], true);
  }

  if (!isSystemdLingerEnabled(username)) {
    fail(`Could not enable systemd lingering for ${username}.`);
  }
}

function isSystemdLingerEnabled(username) {
  return (
    commandOutput("loginctl", [
      "show-user",
      username,
      "--property=Linger",
      "--value",
    ]).toLowerCase() === "yes"
  );
}

async function ensureWorkerEnv() {
  const problem = await validateWorkerEnv();
  if (!problem) return;
  if (!process.stdin.isTTY) {
    fail(
      `${problem} Run npm run worker:service:install in an interactive terminal to complete guided setup, or run npm run setup -- --mode worker first.`,
    );
  }
  console.log(`${problem} Starting guided worker setup...`);
  // The managed clone installs dependencies later. Do not pass --install-service:
  // this installer resumes after setup, without recursively invoking itself.
  run(
    process.execPath,
    [
      join(sourceRoot, "scripts/setup.mjs"),
      "--mode",
      "worker",
      "--skip-install",
    ],
    true,
    sourceRoot,
    0,
  );
  const remainingProblem = await validateWorkerEnv();
  if (remainingProblem) fail(`Worker setup is incomplete: ${remainingProblem}`);
}

async function validateWorkerEnv() {
  let contents;
  try {
    contents = await readFile(envPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return ".env.worker does not exist.";
    throw error;
  }
  workerEnvContents = contents;
  const env = parseEnv(contents);
  const backend = (env.RELAY_WORKER_BACKEND || "openai").toLowerCase();
  const required = ["RELAY_URL", "RELAY_WORKER_TOKEN"];
  if (backend === "openai") required.push("OPENAI_API_KEY");
  else if (backend === "codex")
    required.push(
      "RELAY_CODEX_PATH",
      "RELAY_CODEX_WORKSPACE",
      "RELAY_COMMAND_PATH",
    );
  else return "RELAY_WORKER_BACKEND must be either codex or openai.";

  for (const name of required) {
    if (!env[name]?.trim()) return `${name} is missing from .env.worker.`;
  }
  try {
    if (!["http:", "https:"].includes(new URL(env.RELAY_URL).protocol))
      throw new Error();
  } catch {
    return "RELAY_URL must be an absolute HTTP or HTTPS URL in .env.worker.";
  }
  if (backend === "codex") {
    for (const name of ["RELAY_CODEX_PATH", "RELAY_CODEX_WORKSPACE"]) {
      if (!isAbsolute(env[name]))
        return `${name} must be an absolute path in .env.worker.`;
      try {
        const info = await stat(env[name]);
        if (name === "RELAY_CODEX_PATH") {
          if (!info.isFile()) throw new Error();
          await access(env[name], constants.X_OK);
        } else if (!info.isDirectory()) throw new Error();
      } catch {
        return `${name} is unavailable.`;
      }
    }
  }
}

async function prepareManagedInstall() {
  const installationRoot =
    process.platform === "darwin"
      ? join(homedir(), "Library/Application Support/Relay Worker/app")
      : join(homedir(), ".local/share/relay-worker/app");
  const remote = commandOutput("git", [
    "-C",
    sourceRoot,
    "config",
    "--get",
    "remote.origin.url",
  ]);

  console.log(`Preparing managed worker checkout at ${installationRoot}...`);
  if (!(await pathExists(join(installationRoot, ".git")))) {
    await mkdir(dirname(installationRoot), { recursive: true });
    run("git", [
      "clone",
      "--branch",
      "main",
      "--single-branch",
      remote,
      installationRoot,
    ]);
  } else {
    run("git", ["-C", installationRoot, "fetch", "--quiet", "origin", "main"]);
    run("git", ["-C", installationRoot, "merge", "--ff-only", "origin/main"]);
  }

  await copyFile(
    join(sourceRoot, ".env.worker"),
    join(installationRoot, ".env.worker"),
  );
  await chmod(join(installationRoot, ".env.worker"), 0o600);
  console.log(
    "Installing worker dependencies (this can take several minutes)...",
  );
  run(
    "npm",
    ["ci", "--omit=dev", "--ignore-scripts"],
    false,
    installationRoot,
    10 * 60_000,
  );
  return installationRoot;
}

function autoUpdateSetting() {
  const configured = workerEnvContents
    .match(/^RELAY_WORKER_AUTO_UPDATE=(.+)$/m)?.[1]
    ?.trim()
    .replace(/^(?:"|')(.*)(?:"|')$/, "$1")
    .toLowerCase();
  return configured === "off" ? "off" : "on";
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function childOptions(timeout = 60_000) {
  return {
    timeout,
    killSignal: "SIGKILL",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
  };
}

function run(executable, args, inherit = false, cwd, timeout = 60_000) {
  try {
    execFileSync(executable, args, {
      ...childOptions(timeout),
      cwd,
      stdio: inherit ? "inherit" : ["ignore", "inherit", "inherit"],
    });
  } catch (error) {
    if (error.code === "ETIMEDOUT") {
      fail(
        `${executable} timed out after ${timeout / 1000} seconds. Check the output above, fix any setup or network issue, and retry installation.`,
      );
    }
    fail(error.stderr?.toString().trim() || error.message);
  }
}

function commandOutput(executable, args) {
  try {
    return execFileSync(executable, args, {
      ...childOptions(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    fail(error.stderr?.toString().trim() || error.message);
  }
}

function runAllowFailure(executable, args) {
  try {
    execFileSync(executable, args, { ...childOptions(), stdio: "ignore" });
  } catch {
    // The service may not have been installed yet.
  }
}

async function removeIfPresent(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function systemdPath(value) {
  // WorkingDirectory is a path directive, not a shell-style argument list.
  if (/[\r\n\0]/.test(value) || value.trim() !== value) {
    fail(
      "Service paths cannot contain newlines or leading/trailing whitespace.",
    );
  }
  return value.replaceAll("%", "%%");
}

function systemdQuote(value) {
  value = systemdPath(value).replaceAll("$", "$$");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function xml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function showDryRun(path) {
  console.log(`[dry run] ${command} ${path}`);
}

function printHelp() {
  console.log(`Manage the Relay worker as a background service

Usage:
  npm run worker:service:install
  npm run worker:service:status
  npm run worker:service:uninstall

Supports a LaunchAgent on macOS and a systemd user service on Linux.
`);
}

function fail(message) {
  console.error(`\nService error: ${message}`);
  process.exit(1);
}
