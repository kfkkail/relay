import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRelayClient } from "./relay-client.mjs";

let server;
afterEach(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  server = undefined;
});

async function clientFor(handler) {
  server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return createRelayClient({
    relayUrl: `http://127.0.0.1:${server.address().port}`,
    workerToken: "relay_test",
    timeoutMs: 100,
  });
}

describe("Relay worker HTTP client", () => {
  it("times out stalled response headers and can send the next request", async () => {
    let requests = 0;
    const client = await clientFor((_request, response) => {
      if (++requests > 1) response.end('{"heartbeat":true}');
    });
    await expect(client.request("/heartbeat")).rejects.toThrow("timed out");
    await expect(client.request("/heartbeat")).resolves.toEqual({
      heartbeat: true,
    });
  });

  it.each(["request", "download"])(
    "times out a stalled %s response body",
    async (method) => {
      const client = await clientFor((_request, response) => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.write('{"partial":');
      });
      await expect(client[method]("/stalled-body")).rejects.toThrow(
        "timed out",
      );
    },
  );

  it("preserves caller cancellation", async () => {
    const client = await clientFor(() => {});
    const controller = new AbortController();
    const pending = client.request("/heartbeat", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("preserves claim, download, HTTP error, and multipart upload behavior", async () => {
    const seen = [];
    const client = await clientFor(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      seen.push({
        headers: request.headers,
        body: Buffer.concat(chunks).toString(),
      });
      if (request.url === "/claim") response.writeHead(204).end();
      else if (request.url === "/download") response.end("image bytes");
      else if (request.url === "/error")
        response.writeHead(404).end('{"error":"inactive"}');
      else response.end('{"document":{"id":"doc-1"}}');
    });
    await expect(
      client.request("/claim", { method: "POST" }),
    ).resolves.toBeNull();
    await expect(client.download("/download")).resolves.toEqual(
      Buffer.from("image bytes"),
    );
    await expect(client.request("/error")).rejects.toThrow("inactive");
    const body = new FormData();
    body.set("file", new File(["text"], "result.txt"));
    await expect(
      client.request("/documents", { method: "POST", body }),
    ).resolves.toEqual({ document: { id: "doc-1" } });
    expect(
      seen.every(
        ({ headers }) => headers.authorization === "Bearer relay_test",
      ),
    ).toBe(true);
    expect(seen[3].headers["content-type"]).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    expect(seen[3].body).toContain('filename="result.txt"');
  });

  it("clears request deadlines after success", async () => {
    vi.useFakeTimers();
    try {
      const client = createRelayClient({
        relayUrl: "https://relay.test",
        workerToken: "relay_test",
        fetchImpl: async () => Response.json({ heartbeat: true }),
      });
      await client.request("/heartbeat");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
