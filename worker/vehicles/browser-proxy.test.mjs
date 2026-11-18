import { describe, expect, it, vi } from "vitest";
import { request } from "node:http";
import { createServer, connect } from "node:net";
import { once } from "node:events";
import { startBrowserProxy } from "./browser-proxy.mjs";

function tunnel(network, authority, authenticated = true) {
  return new Promise((resolve, reject) => {
    const proxy = new URL(network.proxy.server);
    const req = request({
      hostname: proxy.hostname,
      port: proxy.port,
      method: "CONNECT",
      path: authority,
      agent: false,
      headers: authenticated
        ? {
            "Proxy-Authorization": `Basic ${Buffer.from(`${network.proxy.username}:${network.proxy.password}`).toString("base64")}`,
          }
        : {},
    });
    req.once("connect", (response, socket, head) =>
      resolve({ response, socket, head }),
    );
    req.once("error", reject);
    req.end();
  });
}
describe("public-only native browser tunnel", () => {
  it("requires per-session authentication before DNS or dialing", async () => {
    const resolve = vi.fn();
    const network = await startBrowserProxy({ resolve });
    try {
      const result = await tunnel(network, "example.com:443", false);
      expect(result.response.statusCode).toBe(407);
      result.socket.destroy();
      expect(resolve).not.toHaveBeenCalled();
    } finally {
      await network.close();
    }
  });
  it.each(["127.0.0.1", "10.0.0.1", "192.168.1.157", "169.254.169.254", "::1"])(
    "rejects DNS answers containing private address %s",
    async (address) => {
      const dial = vi.fn();
      const network = await startBrowserProxy({
        resolve: async () => [{ address: "8.8.8.8", family: 4 }, { address }],
        connectImpl: dial,
      });
      try {
        const result = await tunnel(network, "seller.example:443");
        expect(result.response.statusCode).toBe(502);
        result.socket.destroy();
        expect(dial).not.toHaveBeenCalled();
        expect(network.failure("https://seller.example").diagnostic.code).toBe(
          "unsafe_destination",
        );
      } finally {
        await network.close();
      }
    },
  );
  it.each([
    "seller.example:22",
    "seller.example:8443",
    "user:secret@seller.example:443",
    "seller.example:443/path",
  ])("rejects invalid CONNECT authority %s", async (authority) => {
    const dial = vi.fn();
    const network = await startBrowserProxy({ connectImpl: dial });
    try {
      const result = await tunnel(network, authority);
      expect(result.response.statusCode).toBe(502);
      result.socket.destroy();
      expect(dial).not.toHaveBeenCalled();
    } finally {
      await network.close();
    }
  });
  it("pins the approved IP and transports bytes unchanged (no TLS interception)", async () => {
    const echo = createServer((socket) => socket.pipe(socket));
    echo.listen(0, "127.0.0.1");
    await once(echo, "listening");
    const dial = vi.fn(() =>
      connect({ host: "127.0.0.1", port: echo.address().port }),
    );
    const network = await startBrowserProxy({
      resolve: async () => [{ address: "8.8.8.8", family: 4 }],
      connectImpl: dial,
    });
    try {
      const { response, socket } = await tunnel(network, "seller.example:443");
      expect(response.statusCode).toBe(200);
      expect(dial).toHaveBeenCalledWith({
        host: "8.8.8.8",
        port: 443,
        family: 4,
      });
      const received = once(socket, "data");
      socket.write(Buffer.from([22, 3, 1, 0, 4, 1, 2, 3, 4]));
      expect((await received)[0]).toEqual(
        Buffer.from([22, 3, 1, 0, 4, 1, 2, 3, 4]),
      );
      socket.destroy();
    } finally {
      await network.close();
      await new Promise((done) => echo.close(done));
    }
  });
  it("bounds connection attempts", async () => {
    const network = await startBrowserProxy({ maxConnections: 0 });
    try {
      const result = await tunnel(network, "seller.example:443");
      expect(result.response.statusCode).toBe(502);
      result.socket.destroy();
      expect(network.failure("https://seller.example").diagnostic.code).toBe(
        "request_limit",
      );
    } finally {
      await network.close();
    }
  });
});
