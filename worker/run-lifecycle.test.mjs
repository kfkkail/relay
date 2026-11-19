import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let child, server, directory;
afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const closed = once(child, "close");
    child.kill("SIGKILL");
    await closed;
  }
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (directory) await rm(directory, { recursive: true, force: true });
  child = server = directory = undefined;
});

describe("worker run heartbeat lifetime", () => {
  it("updates Codex using the configured executable after an idle claim", async () => {
    directory = await mkdtemp(join(tmpdir(), "relay-update-lifecycle-"));
    const marker = join(directory, "codex-updated");
    const executable = join(directory, "codex-fixture.mjs");
    await writeFile(
      executable,
      `#!${process.execPath}
import fs from 'node:fs';
const marker = ${JSON.stringify(marker)};
if (process.argv.includes('--version')) console.log('codex-cli '+(fs.existsSync(marker)?'0.167.0':'0.160.0'));
else if (process.argv[2] === 'update') fs.writeFileSync(marker, 'updated');
else console.log(JSON.stringify({resultMarkdown:fs.existsSync(marker)?'updated':'old',documents:[]}));
`,
    );
    await chmod(executable, 0o700);
    let checkedQueue = false,
      claimed = false,
      updatedBeforeClaim = false,
      result;
    server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      response.setHeader("Content-Type", "application/json");
      if (request.url.endsWith("/wakeup")) return response.writeHead(204).end();
      if (request.url.endsWith("/claim")) {
        if (!checkedQueue) {
          checkedQueue = true;
          return response.writeHead(204).end();
        }
        if (claimed) return response.writeHead(204).end();
        claimed = true;
        updatedBeforeClaim = await readFile(marker, "utf8")
          .then((value) => value === "updated")
          .catch(() => false);
        return response.end(
          JSON.stringify({
            run: { id: "update-task", attempt: 1, job_kind: "agent" },
            task: {
              title: "Fixture",
              instructions: "Fixture",
              deliverable: "investigation",
            },
          }),
        );
      }
      if (request.url.endsWith("/complete") || request.url.endsWith("/fail")) {
        result = JSON.parse(Buffer.concat(chunks).toString());
        child.kill("SIGTERM");
      }
      response.end('{"ok":true}');
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    child = spawn(process.execPath, ["worker/index.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        RELAY_URL: `http://127.0.0.1:${server.address().port}`,
        RELAY_WORKER_TOKEN: "relay_test",
        RELAY_WORKER_BACKEND: "codex",
        RELAY_CODEX_PATH: executable,
        RELAY_CODEX_WORKSPACE: directory,
        RELAY_CODEX_ADDITIONAL_WRITABLE_DIRS: "",
        RELAY_CODEX_MODEL: "",
        RELAY_CODEX_TIMEOUT_MS: "5000",
        RELAY_POLL_INTERVAL_MS: "10",
        RELAY_RUN_HEARTBEAT_INTERVAL_MS: "1000",
        RELAY_WORKER_AUTO_UPDATE: "off",
        RELAY_CODEX_AUTO_UPDATE: "on",
        RELAY_VEHICLE_SEARCH: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const [code] = await once(child, "close");
    expect(code, output).toBe(0);
    expect(updatedBeforeClaim).toBe(true);
    expect(result.resultMarkdown).toBe("updated");
    expect(output).toContain("Codex update check: updated (0.167.0)");
  }, 10000);

  it.each(["complete", "fail"])(
    "renews during Codex execution and a slow /%s response, then shuts down cleanly",
    async (terminalAction) => {
      directory = await mkdtemp(join(tmpdir(), "relay-lifecycle-"));
      const executable = join(directory, "codex-fixture");
      await writeFile(
        executable,
        `#!${process.execPath}
process.stdin.resume();
process.stdin.on("end", () => setTimeout(() => {
  ${terminalAction === "fail" ? "process.exit(1);" : 'console.log(JSON.stringify({ resultMarkdown: "Finished task", documents: [] }));'}
}, 1200));
`,
      );
      await chmod(executable, 0o700);
      let claimed = false;
      let terminalStarted = false;
      let executionHeartbeats = 0;
      let terminalHeartbeats = 0;
      const terminalRequests = [];
      server = createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        response.setHeader("Content-Type", "application/json");
        if (request.url.endsWith("/wakeup"))
          return response.writeHead(204).end();
        if (request.url.endsWith("/claim")) {
          if (claimed) return response.writeHead(204).end();
          claimed = true;
          return response.end(
            JSON.stringify({
              run: { id: "test-run", attempt: 1, job_kind: "agent" },
              task: {
                title: "Fixture task",
                instructions: "Fixture",
                deliverable: "investigation",
              },
            }),
          );
        }
        if (request.url.endsWith("/heartbeat")) {
          if (terminalStarted) terminalHeartbeats++;
          else executionHeartbeats++;
          return response.end('{"heartbeat":true}');
        }
        terminalStarted = true;
        terminalRequests.push({
          url: request.url,
          body: JSON.parse(Buffer.concat(chunks).toString()),
        });
        // Stop claiming new work while the active run drains normally.
        child.kill("SIGTERM");
        setTimeout(() => response.end('{"ok":true}'), 2200);
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      child = spawn(process.execPath, ["worker/index.mjs"], {
        cwd: new URL("..", import.meta.url),
        env: {
          ...process.env,
          RELAY_URL: `http://127.0.0.1:${server.address().port}`,
          RELAY_WORKER_TOKEN: "relay_test",
          RELAY_WORKER_BACKEND: "codex",
          RELAY_CODEX_PATH: executable,
          RELAY_CODEX_WORKSPACE: directory,
          RELAY_CODEX_ADDITIONAL_WRITABLE_DIRS: "",
          RELAY_CODEX_TIMEOUT_MS: "5000",
          RELAY_POLL_INTERVAL_MS: "10",
          RELAY_RUN_HEARTBEAT_INTERVAL_MS: "1000",
          RELAY_WORKER_AUTO_UPDATE: "off",
          RELAY_VEHICLE_SEARCH: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", (chunk) => (output += chunk));
      const [code] = await once(child, "close");
      expect(code, output).toBe(0);
      expect(terminalRequests).toHaveLength(1);
      expect(terminalRequests[0].url).toBe(
        `/api/worker/runs/test-run/${terminalAction}`,
      );
      if (terminalAction === "complete")
        expect(terminalRequests[0].body.resultMarkdown).toBe("Finished task");
      else
        expect(terminalRequests[0].body.error).toContain(
          "exited with status 1",
        );
      expect(executionHeartbeats).toBeGreaterThanOrEqual(1);
      expect(terminalHeartbeats).toBeGreaterThanOrEqual(2);
      expect(output).toContain("Relay worker stopped");
    },
    15_000,
  );
});
