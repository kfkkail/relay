import { execFile } from "node:child_process";
import { promisify, stripVTControlCharacters } from "node:util";
import { codexEnvironment, runWithCodex } from "./codex-runner.mjs";
import { createTaskRunner } from "./task-runner.mjs";

const exec = promisify(execFile);

// This probe uses a fixed prompt, never a failed task or conversation. Raw task
// diagnostics remain private; only this explicit command prints a redacted error.
export async function diagnoseWorker(env = process.env, dependencies = {}) {
  if ((env.RELAY_WORKER_BACKEND || "openai").toLowerCase() !== "codex")
    return {
      ok: false,
      error: "worker:doctor requires RELAY_WORKER_BACKEND=codex.",
    };

  const report = { ok: false, model: env.RELAY_CODEX_MODEL || "gpt-6.2-sol" };
  const run = dependencies.exec || exec;
  try {
    const result = await run(env.RELAY_CODEX_PATH || "codex", ["--version"], {
      env: codexEnvironment(env),
      timeout: 10_000,
      maxBuffer: 4096,
    });
    report.version =
      result.stdout.match(/codex(?:-cli)?\s+[\w.+-]+/i)?.[0] ||
      "unrecognized version";
  } catch {
    report.version = "unavailable";
  }

  const runner = createTaskRunner(env, {
    runCodex: (input, options) =>
      (dependencies.runCodex || runWithCodex)(input, {
        ...options,
        timeoutMs: 30_000,
        onDiagnostic: ({ stderr }) => {
          report.diagnostic = redactDiagnostic(stderr, env);
        },
      }),
  });
  try {
    const result = await runner.run(
      'This is a worker startup diagnostic. Do not use tools, read files, access connections, or change anything. Return exactly {"resultMarkdown":"Relay worker ready","documents":[]}.',
      "Test model access only. Do not use tools or perform any actions. Return the requested JSON response.",
    );
    report.ok = result.resultMarkdown === "Relay worker ready";
    if (!report.ok)
      report.error =
        "Codex ran but did not return the expected diagnostic response.";
  } catch (error) {
    report.error =
      error instanceof Error ? error.message : "Unknown worker error";
  }
  return report;
}

export function redactDiagnostic(stderr, env) {
  let text = stripVTControlCharacters(stderr);
  for (const [name, value] of Object.entries(env)) {
    if (value && /token|key|secret|password|auth/i.test(name))
      text = text.split(value).join("[redacted]");
  }
  text = text
    .replace(/\b(?:sk-|ghp_|gho_|relay_)[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g,
      "[redacted]",
    )
    .replace(
      /(Bearer\s+|(?:api[_-]?key|token|secret|password)\s*[=:]\s*)\S+/gi,
      "$1[redacted]",
    )
    .replace(/https?:\/\/[^\s<>"']+/g, (value) => {
      try {
        const url = new URL(value);
        url.username = url.password = url.search = url.hash = "";
        return url.toString();
      } catch {
        return "[redacted URL]";
      }
    });
  return (
    text
      .split("\n")
      .filter((line) =>
        /(?:^|\s)(?:error\b|caused by:|unexpected argument\b)/i.test(line),
      )
      .join("\n")
      .slice(-2000) || "No terminal error line was available."
  );
}
