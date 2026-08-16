import { execFileSync } from "node:child_process";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
const label = "com.relay.worker";
const envPath = join(root, ".env.worker");
const workerPath = join(root, "worker/index.mjs");

if (!command || process.argv.includes("--help") || process.argv.includes("-h")) {
  printHelp();
  process.exit(command ? 0 : 1);
}

if (!new Set(["install", "status", "uninstall"]).has(command)) {
  fail(`Unknown command: ${command}.`);
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
    await validateWorkerEnv();
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
  console.log("Relay worker service removed. Worker logs were kept in .relay/.");
}

async function manageSystemd(action) {
  const directory = join(homedir(), ".config/systemd/user");
  const servicePath = join(directory, "relay-worker.service");

  if (action === "install") {
    await validateWorkerEnv();
    const unit = `[Unit]
Description=Relay worker
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemdQuote(root)}
ExecStart=${systemdQuote(process.execPath)} ${systemdQuote(`--env-file=${envPath}`)} ${systemdQuote(workerPath)}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
    if (dryRun) return showDryRun(servicePath);
    await mkdir(directory, { recursive: true });
    await writeFile(servicePath, unit, { mode: 0o644 });
    run("systemctl", ["--user", "daemon-reload"]);
    run("systemctl", ["--user", "enable", "--now", "relay-worker.service"]);
    console.log("Relay worker installed and started as a systemd user service.");
    console.log("For start-at-boot before login, an administrator can run:");
    console.log(`  sudo loginctl enable-linger ${userInfo().username}`);
    return;
  }

  if (action === "status") {
    run("systemctl", ["--user", "status", "relay-worker.service"], true);
    return;
  }

  if (dryRun) return showDryRun(servicePath);
  runAllowFailure("systemctl", ["--user", "disable", "--now", "relay-worker.service"]);
  await removeIfPresent(servicePath);
  run("systemctl", ["--user", "daemon-reload"]);
  console.log("Relay worker service removed.");
}

async function validateWorkerEnv() {
  let contents;
  try {
    contents = await readFile(envPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") fail(".env.worker does not exist. Run npm run setup -- --mode worker first.");
    throw error;
  }
  const env = Object.fromEntries(contents
    .split(/\r?\n/)
    .filter((line) => line && !line.trimStart().startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^(["'])(.*)\1$/, "$2")];
    }));
  const backend = (env.RELAY_WORKER_BACKEND || "openai").toLowerCase();
  const required = ["RELAY_URL", "RELAY_WORKER_TOKEN"];
  if (backend === "openai") required.push("OPENAI_API_KEY");
  else if (backend === "codex") required.push(
    "RELAY_CONTAINER_RUNTIME",
    "RELAY_CODEX_IMAGE",
    "RELAY_CODEX_AUTH_FILE",
    "RELAY_CODEX_WORKSPACE",
  );
  else fail("RELAY_WORKER_BACKEND must be either codex or openai.");

  for (const name of required) {
    if (!new RegExp(`^${name}=.+$`, "m").test(contents)) fail(`${name} is missing from .env.worker.`);
  }
}

function run(executable, args, inherit = false) {
  try {
    execFileSync(executable, args, { stdio: inherit ? "inherit" : "pipe" });
  } catch (error) {
    fail(error.stderr?.toString().trim() || error.message);
  }
}

function runAllowFailure(executable, args) {
  try {
    execFileSync(executable, args, { stdio: "ignore" });
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

function systemdQuote(value) {
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
