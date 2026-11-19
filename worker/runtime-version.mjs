import { execFile } from "node:child_process";

let workerRevision;

function commandOutput(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        timeout: 3000,
        maxBuffer: 4096,
        ...options,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
    child.stdin?.end();
  });
}

export async function readRuntimeVersion(
  { command, env },
  run = commandOutput,
) {
  // The managed worker restarts after updates. Keep its loaded revision stable
  // while checking the actual Codex executable again for each failed run.
  workerRevision ??= commandOutput("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: new URL("..", import.meta.url),
  })
    .then((value) =>
      /^[a-f0-9]{7,40}$/.test(value.trim()) ? value.trim() : "unknown",
    )
    .catch(() => "unknown");
  const [codex, relay] = await Promise.all([
    run(command, ["--version"], { env })
      .then(
        (value) =>
          value.match(/codex(?:-cli)?\s+(\d[\w.+-]*)/i)?.[1] || "unknown",
      )
      .catch(() => "unavailable"),
    workerRevision,
  ]);
  return { codex, relay };
}

export function versionedFailure(message, versions, model) {
  const selected = model
    ? /^[\w.:-]{1,100}$/.test(model)
      ? model
      : "explicit override"
    : "CLI default";
  return `${message} [Codex ${versions.codex}; Relay ${versions.relay}; model ${selected}]`;
}
