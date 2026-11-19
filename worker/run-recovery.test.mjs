import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";

let worker, server, directory;
afterEach(async () => {
  if (worker?.exitCode === null && worker?.signalCode === null) {
    const closed = once(worker, "close");
    worker.kill("SIGKILL");
    await closed;
  }
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (directory) await rm(directory, { recursive: true, force: true });
  worker = server = directory = undefined;
});

async function runFixture({
  body,
  heartbeatReply,
  attachments = [],
  download,
  complete,
}) {
  directory = await mkdtemp(join(tmpdir(), "relay-recovery-"));
  const marker = join(directory, "external-action");
  const executable = join(directory, "codex-fixture");
  await writeFile(
    executable,
    `#!${process.execPath}\n${body.replaceAll("MARKER", JSON.stringify(marker))}\n`,
  );
  await chmod(executable, 0o700);
  let claimed = false,
    heartbeats = 0;
  const terminal = [];
  server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader("Content-Type", "application/json");
    if (request.url.endsWith("/wakeup")) return response.writeHead(204).end();
    if (request.url.endsWith("/claim")) {
      if (claimed) return response.writeHead(204).end();
      claimed = true;
      return response.end(
        JSON.stringify({
          run: { id: "test-run", attempt: 1 },
          task: {
            title: "Fixture",
            instructions: "Fixture",
            deliverable: "investigation",
            conversation: true,
          },
          attachments,
        }),
      );
    }
    if (request.url.endsWith("/heartbeat")) {
      heartbeats++;
      const status = heartbeatReply(heartbeats, terminal);
      return response
        .writeHead(status)
        .end(
          status === 200
            ? '{"heartbeat":true}'
            : '{"error":"renewal rejected"}',
        );
    }
    if (request.url.includes("/attachments/"))
      return download(request, response);
    terminal.push({
      url: request.url,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    });
    worker.kill("SIGTERM");
    if (request.url.endsWith("/complete") && complete)
      return complete(response);
    response.end('{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  worker = spawn(process.execPath, ["worker/index.mjs"], {
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
      RELAY_CODEX_TIMEOUT_MS: "8000",
      RELAY_RUN_HEARTBEAT_INTERVAL_MS: "1000",
      RELAY_POLL_INTERVAL_MS: "10",
      RELAY_WORKER_AUTO_UPDATE: "off",
      RELAY_CODEX_AUTO_UPDATE: "off",
      RELAY_VEHICLE_SEARCH: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  worker.stdout.on("data", (chunk) => (output += chunk));
  worker.stderr.on("data", (chunk) => (output += chunk));
  const [code] = await once(worker, "close");
  expect(code, output).toBe(0);
  return { terminal, marker, output, heartbeats };
}

describe("worker heartbeat recovery", () => {
  it("recovers from a transient 503 and submits the original run once", async () => {
    const result = await runFixture({
      body: `process.stdin.resume(); process.stdin.on('end', () => setTimeout(() => console.log(JSON.stringify({resultMarkdown:'Recovered task',documents:[]})), 4200));`,
      heartbeatReply: (count) => (count === 2 ? 503 : 200),
    });
    expect(result.terminal).toHaveLength(1);
    expect(result.terminal[0].url).toMatch(/\/complete$/);
    expect(result.terminal[0].body.resultMarkdown).toBe("Recovered task");
    expect(result.output).toContain("Heartbeat recovered for test-run");
  }, 12_000);

  it.each([401, 403, 404])(
    "kills Codex and a stubborn subprocess after a definitive HTTP %s rejection",
    async (status) => {
      const result = await runFixture({
        body: `import { spawn } from 'node:child_process';
import fs from 'node:fs';
process.on('SIGTERM',()=>{});
spawn(process.execPath,['-e', 'process.on("SIGTERM",()=>{}); setTimeout(()=>require("node:fs").writeFileSync('+JSON.stringify(MARKER)+',"child action"),2500);'],{stdio:'ignore'});
process.stdin.resume();
process.stdin.on('end',()=>setTimeout(()=>{fs.writeFileSync(MARKER,'parent action'); console.log(JSON.stringify({resultMarkdown:'Too late',documents:[]}));},2500));`,
        heartbeatReply: (count) => (count === 1 ? 200 : status),
      });
      expect(result.terminal).toHaveLength(1);
      expect(result.terminal[0].url).toMatch(/\/fail$/);
      expect(result.terminal[0].body.error).toContain(
        "Worker heartbeat rejected",
      );
      // Wait past both fixture actions to prove cancellation reaches descendants.
      await delay(2600);
      await expect(readFile(result.marker)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(result.output).not.toContain("Completed run");
    },
    10_000,
  );

  it("cancels a stalled attachment download without ever invoking Codex", async () => {
    const result = await runFixture({
      body: `import fs from 'node:fs'; fs.writeFileSync(MARKER,'Codex started');`,
      heartbeatReply: (count) => (count === 1 ? 200 : 404),
      attachments: [
        {
          id: "image",
          file_name: "image.png",
          mime_type: "image/png",
          byte_size: 20,
        },
      ],
      download: (_request, response) => {
        response.writeHead(200);
        response.write("partial");
      },
    });
    expect(result.terminal).toHaveLength(1);
    expect(result.terminal[0].url).toMatch(/\/fail$/);
    expect(result.terminal[0].body.error).toContain(
      "Worker heartbeat rejected",
    );
    await expect(readFile(result.marker)).rejects.toMatchObject({
      code: "ENOENT",
    });
  }, 10_000);

  it("accepts a successful completion response even if a later heartbeat sees the completed run as inactive", async () => {
    const result = await runFixture({
      body: `process.stdin.resume(); process.stdin.on('end', () => setTimeout(() => console.log(JSON.stringify({resultMarkdown:'Already committed',documents:[]})),1200));`,
      heartbeatReply: (_count, terminal) => (terminal.length ? 404 : 200),
      complete: (response) => {
        setTimeout(() => response.end('{"completed":true}'), 1800);
      },
    });
    expect(result.terminal).toHaveLength(1);
    expect(result.terminal[0].url).toMatch(/\/complete$/);
    expect(result.output).toContain("Completed run test-run");
    expect(result.output).not.toContain("Run test-run failed");
  }, 10_000);
});
