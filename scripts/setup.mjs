import { chmod, readFile, writeFile } from "node:fs/promises";
import { accessSync, constants, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const major = Number(process.versions.node.split(".")[0]);
if (!Number.isInteger(major) || major < 22) {
  fail(`Relay requires Node.js 22 or newer; found ${process.version}.`);
}

console.log("\nRelay guided setup");
console.log("==================\n");

const mode = args.mode || (args.yes ? "both" : await chooseMode());
if (!new Set(["web", "worker", "both"]).has(mode)) {
  fail(`Unknown setup mode: ${mode}. Use web, worker, or both.`);
}

if (!args.skipInstall) {
  const shouldInstall =
    args.yes ||
    (await confirm("Install exact package versions with npm ci?", true));
  if (shouldInstall) {
    if (args.dryRun) {
      console.log("[dry run] npm ci");
    } else {
      run("npm", ["ci"], "Dependency installation failed.");
    }
  }
}

if (mode === "web" || mode === "both") await configureWeb();
const workerBackend =
  mode === "worker" || mode === "both" ? await configureWorker() : undefined;

if ((mode === "worker" || mode === "both") && args.installService) {
  if (args.dryRun) {
    console.log("[dry run] Install the Relay worker background service");
  } else {
    run(
      process.execPath,
      [join(root, "scripts/worker-service.mjs"), "install"],
      "Service installation failed.",
    );
  }
}

printNextSteps(mode, workerBackend);

async function configureWeb() {
  const target = join(root, ".env.local");
  const existing = await readEnv(target);
  console.log("\nWeb application settings (.env.local)");
  console.log("Find these values in Supabase under Project Settings → API.\n");

  const values = {
    NEXT_PUBLIC_SUPABASE_URL: await askValue("Supabase project URL", {
      name: "NEXT_PUBLIC_SUPABASE_URL",
      existing,
      validate: validateHttpUrl,
    }),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: await askValue(
      "Supabase publishable key",
      {
        name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        existing,
        secret: true,
      },
    ),
    SUPABASE_SECRET_KEY: await askValue("Supabase secret key", {
      name: "SUPABASE_SECRET_KEY",
      existing,
      secret: true,
    }),
  };

  await saveEnv(target, values);
}

async function configureWorker() {
  const target = join(root, ".env.worker");
  const existing = await readEnv(target);
  console.log("\nWorker settings (.env.worker)");
  console.log(
    "Create the worker token inside Relay after the web application is running.\n",
  );

  const backend = await chooseWorkerBackend(existing);
  const values = {
    RELAY_URL: await askValue("Deployed Relay URL", {
      name: "RELAY_URL",
      existing,
      validate: validateHttpUrl,
    }),
    RELAY_WORKER_TOKEN: await askValue("Relay worker token", {
      name: "RELAY_WORKER_TOKEN",
      existing,
      secret: true,
    }),
    RELAY_WORKER_BACKEND: backend,
  };

  if (backend === "codex") {
    values.RELAY_CODEX_PATH = await askValue("Codex CLI path", {
      name: "RELAY_CODEX_PATH",
      existing,
      fallback: findExecutable("codex"),
      validate: validateCodex,
    });
    values.RELAY_CODEX_WORKSPACE = await askValue(
      "Allowed workspace directory",
      {
        name: "RELAY_CODEX_WORKSPACE",
        existing,
        fallback: root,
        validate: validateDirectory,
      },
    );
    values.RELAY_COMMAND_PATH = await askValue("Command search path", {
      name: "RELAY_COMMAND_PATH",
      existing,
      fallback: process.env.PATH,
    });
    values.RELAY_CODEX_MODEL = await askOptionalValue(
      "Codex model (blank uses your CLI default)",
      {
        name: "RELAY_CODEX_MODEL",
        existing,
      },
    );
    values.RELAY_CODEX_TIMEOUT_MS = await askValue(
      "Codex timeout in milliseconds",
      {
        name: "RELAY_CODEX_TIMEOUT_MS",
        existing,
        fallback: "900000",
        validate: validateMilliseconds,
      },
    );
  } else {
    values.OPENAI_API_KEY = await askValue("OpenAI API key", {
      name: "OPENAI_API_KEY",
      existing,
      secret: true,
    });
    values.OPENAI_MODEL = await askValue("OpenAI model", {
      name: "OPENAI_MODEL",
      existing,
      fallback: "gpt-5.6-sol",
    });
  }

  Object.assign(values, {
    RELAY_POLL_INTERVAL_MS: await askValue("Polling interval in milliseconds", {
      name: "RELAY_POLL_INTERVAL_MS",
      existing,
      fallback: "5000",
      validate: validateMilliseconds,
    }),
  });

  await saveEnv(target, values);
  return backend;
}

async function chooseWorkerBackend(existing) {
  const current = (
    process.env.RELAY_WORKER_BACKEND ||
    existing.RELAY_WORKER_BACKEND ||
    (existing.OPENAI_API_KEY ? "openai" : "codex")
  ).toLowerCase();
  if (!new Set(["codex", "openai"]).has(current)) {
    fail("RELAY_WORKER_BACKEND must be either codex or openai.");
  }
  if (args.yes) return current;

  console.log("Worker backend:");
  console.log("  1. Codex CLI (uses your ChatGPT/Codex login)");
  console.log("  2. OpenAI API (uses API billing)\n");
  const defaultChoice = current === "openai" ? "2" : "1";
  while (true) {
    const answer =
      (await question(`Choose 1 or 2 [${defaultChoice}]: `)).trim() ||
      defaultChoice;
    if (answer === "1") return "codex";
    if (answer === "2") return "openai";
    console.log("Please choose 1 or 2.");
  }
}

async function askValue(label, options) {
  const current =
    process.env[options.name] ||
    options.existing[options.name] ||
    options.fallback ||
    "";

  if (args.yes) {
    if (!current) fail(`${options.name} is required in non-interactive mode.`);
    const problem = options.validate?.(current);
    if (problem) fail(`${options.name}: ${problem}`);
    return current;
  }

  while (true) {
    const suffix = current
      ? options.secret
        ? " [already set]"
        : ` [${current}]`
      : "";
    const answer = await question(`${label}${suffix}: `, options.secret);
    const value = answer.trim() || current;
    if (!value) {
      console.log("A value is required.");
      continue;
    }
    const problem = options.validate?.(value);
    if (problem) {
      console.log(problem);
      continue;
    }
    return value;
  }
}

async function askOptionalValue(label, options) {
  const current =
    process.env[options.name] ??
    options.existing[options.name] ??
    options.fallback ??
    "";
  if (args.yes) return current;
  const suffix = current
    ? options.secret
      ? " [already set]"
      : ` [${current}]`
    : "";
  const answer = await question(`${label}${suffix}: `, options.secret);
  return answer.trim() || current;
}

async function saveEnv(target, values) {
  const contents =
    Object.entries(values)
      .map(([name, value]) => `${name}=${formatEnvValue(value)}`)
      .join("\n") + "\n";

  if (args.dryRun) {
    console.log(`[dry run] Write ${target}`);
    return;
  }

  await writeFile(target, contents, { mode: 0o600 });
  await chmod(target, 0o600);
  console.log(`Saved ${target} with owner-only permissions.`);
}

async function chooseMode() {
  console.log("What do you want to configure?");
  console.log("  1. Web application");
  console.log("  2. Worker on this device");
  console.log("  3. Both\n");
  while (true) {
    const value = (await question("Choose 1, 2, or 3 [1]: ")).trim() || "1";
    if (value === "1") return "web";
    if (value === "2") return "worker";
    if (value === "3") return "both";
    console.log("Please choose 1, 2, or 3.");
  }
}

async function confirm(label, defaultValue) {
  const hint = defaultValue ? "Y/n" : "y/N";
  const answer = (await question(`${label} [${hint}] `)).trim().toLowerCase();
  if (!answer) return defaultValue;
  return answer === "y" || answer === "yes";
}

async function question(prompt, secret = false) {
  if (!secret || !process.stdin.isTTY) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      return await rl.question(prompt);
    } finally {
      rl.close();
    }
  }

  let muted = false;
  const hiddenOutput = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const rl = createInterface({
    input: process.stdin,
    output: hiddenOutput,
    terminal: true,
  });
  try {
    const answer = rl.question(prompt);
    muted = true;
    const value = await answer;
    process.stdout.write("\n");
    return value;
  } finally {
    rl.close();
  }
}

async function readEnv(path) {
  try {
    const contents = await readFile(path, "utf8");
    return Object.fromEntries(
      contents
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          const name = line.slice(0, index).trim();
          let value = line.slice(index + 1).trim();
          if (value.startsWith('"') && value.endsWith('"')) {
            try {
              value = JSON.parse(value);
            } catch {
              value = value.slice(1, -1);
            }
          } else if (value.startsWith("'") && value.endsWith("'")) {
            value = value.slice(1, -1);
          }
          return [name, value];
        }),
    );
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function formatEnvValue(value) {
  return /^[A-Za-z0-9_./:@+-]+$/.test(value) ? value : JSON.stringify(value);
}

function validateHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? null
      : "Use an http:// or https:// URL.";
  } catch {
    return "Enter a complete URL, including https://.";
  }
}

function validateMilliseconds(value) {
  return /^\d+$/.test(value) && Number(value) >= 1000
    ? null
    : "Enter an integer of at least 1000 milliseconds.";
}

function validateDirectory(value) {
  if (!isAbsolute(value)) return "Enter an absolute directory path.";
  try {
    return statSync(value).isDirectory()
      ? null
      : "Enter an existing directory path.";
  } catch {
    return "Enter an existing directory path.";
  }
}

function validateCodex(value) {
  if (!isAbsolute(value)) return "Enter the absolute path to the Codex CLI.";
  try {
    accessSync(value, constants.X_OK);
  } catch {
    return "Enter an existing executable path.";
  }
  const result = spawnSync(value, ["--version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return "Codex CLI could not be started from that path.";
  }
  return null;
}

function findExecutable(name) {
  if (isAbsolute(name)) return name;
  for (const directory of (process.env.PATH || "")
    .split(delimiter)
    .filter(Boolean)) {
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

function run(command, commandArgs, errorMessage) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) fail(errorMessage);
}

function printNextSteps(selectedMode, selectedBackend) {
  console.log("\nSetup files are ready.\n");
  if (selectedMode === "web" || selectedMode === "both") {
    console.log("Web next steps:");
    console.log(
      "  1. Run supabase/migrations/0001_initial.sql in the Supabase SQL Editor.",
    );
    console.log("  2. Run npm run dev, or deploy the repository to Vercel.");
    console.log(
      "  3. Add your Relay URL and /auth/callback to Supabase Auth redirect URLs.\n",
    );
  }
  if (selectedMode === "worker" || selectedMode === "both") {
    console.log("Worker next steps:");
    if (selectedBackend === "codex") {
      console.log(
        "  • Keep `codex login` and `gh auth login` current for this user",
      );
    }
    console.log(
      "  • Test in the foreground: node --env-file=.env.worker worker/index.mjs",
    );
    if (!args.installService)
      console.log("  • Run continuously: npm run worker:service:install");
    console.log("");
  }
}

function parseArgs(rawArgs) {
  const parsed = {
    mode: undefined,
    yes: false,
    skipInstall: false,
    installService: false,
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--mode") parsed.mode = rawArgs[++index];
    else if (arg.startsWith("--mode="))
      parsed.mode = arg.slice("--mode=".length);
    else if (arg === "--yes" || arg === "-y") parsed.yes = true;
    else if (arg === "--skip-install") parsed.skipInstall = true;
    else if (arg === "--install-service") parsed.installService = true;
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else fail(`Unknown option: ${arg}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Relay guided setup

Usage:
  npm run setup
  npm run setup -- --mode web
  npm run setup -- --mode worker --install-service

Options:
  --mode web|worker|both  Configure one or both Relay components
  --install-service      Install and start the worker in the background
  --skip-install         Do not run npm ci
  --yes, -y              Read values from the environment without prompting
  --dry-run              Validate and show actions without writing files
  --help, -h             Show this help
`);
}

function fail(message) {
  console.error(`\nSetup error: ${message}`);
  process.exit(1);
}
