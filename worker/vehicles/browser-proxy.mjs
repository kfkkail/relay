import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { lookup } from "node:dns/promises";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { isPublicAddress, safePageUrl } from "./detail-enrichment.mjs";
import { SellerPageError, sellerPageError } from "./seller-error.mjs";

// A CONNECT tunnel is not a fetch/MITM proxy: Chromium owns end-to-end TLS,
// HTTP, cookies and JavaScript. Resolve/pin each upstream TCP connection here
// to retain the private-network boundary without replacing browser responses.
export async function startBrowserProxy({
  resolve = lookup,
  connectImpl = connect,
  httpRequestImpl = httpRequest,
  maxBytes = 40_000_000,
  maxConnections = 160,
} = {}) {
  const username = "relay";
  const password = randomBytes(24).toString("hex");
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const sockets = new Set();
  const failures = new Map();
  let bytes = 0,
    connections = 0,
    limitFailure;
  let closing = false;
  const track = (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.setTimeout(15_000, () => socket.destroy());
    socket.on("error", () => {});
    return socket;
  };
  const remember = (url, error) => {
    const failure = sellerPageError(error, url.href);
    failures.set(url.hostname, failure);
    return failure;
  };
  async function addressFor(url) {
    safePageUrl(url.href);
    if (++connections > maxConnections) {
      limitFailure = new SellerPageError("request_limit", url.href);
      throw limitFailure;
    }
    const addresses = await resolve(url.hostname, {
      all: true,
      verbatim: true,
    });
    if (closing) throw new Error("proxy_closed");
    if (
      !addresses.length ||
      addresses.some(({ address }) => !isPublicAddress(address))
    )
      throw new Error("unsafe_address");
    // Pi installations commonly have public AAAA answers without working IPv6.
    // Prefer an approved IPv4 address, without ever falling back to private DNS.
    return addresses.find(({ family }) => family === 4) || addresses[0];
  }
  function account(chunk, url) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      limitFailure = new SellerPageError("response_too_large", url.href);
      for (const socket of sockets) socket.destroy();
    }
  }
  const server = createServer(async (req, res) => {
    if (req.headers["proxy-authorization"] !== authorization) {
      res.writeHead(407, { "Proxy-Authenticate": 'Basic realm="relay"' });
      res.end();
      return;
    }
    let url;
    try {
      url = safePageUrl(req.url);
      if (url.protocol !== "http:") throw new Error("unsafe_url");
      const address = await addressFor(url);
      const headers = { ...req.headers };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const upstream = httpRequestImpl(
        {
          hostname: address.address,
          family: address.family,
          port: 80,
          method: req.method,
          path: url.pathname + url.search,
          headers,
          agent: false,
        },
        (response) => {
          res.writeHead(response.statusCode, response.headers);
          response.on("data", (chunk) => account(chunk, url));
          response.on("error", () => res.destroy());
          response.pipe(res);
        },
      );
      upstream.on("socket", track);
      upstream.on("error", (error) => {
        remember(url, error);
        res.destroy();
      });
      req.on("data", (chunk) => account(chunk, url));
      req.on("aborted", () => upstream.destroy());
      res.on("close", () => upstream.destroy());
      req.pipe(upstream);
    } catch (error) {
      if (url) remember(url, error);
      if (!res.headersSent) res.writeHead(502);
      res.end();
    }
  });
  server.on("connection", track);
  server.on("clientError", (_, socket) => socket.destroy());
  server.on("connect", async (req, client, head) => {
    if (req.headers["proxy-authorization"] !== authorization) {
      client.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="relay"\r\n\r\n',
      );
      return;
    }
    let url;
    try {
      // CONNECT accepts an authority only, never credentials/path/query or
      // arbitrary ports. This also rejects malformed IPv6 authorities.
      url = safePageUrl(`https://${req.url}`);
      if (
        url.port ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        !req.url.endsWith(":443")
      )
        throw new Error("unsafe_url");
      const address = await addressFor(url);
      if (client.destroyed) return;
      const upstream = track(
        connectImpl({
          host: address.address,
          family: address.family,
          port: 443,
        }),
      );
      const cleanup = () => {
        client.destroy();
        upstream.destroy();
      };
      client.once("close", () => upstream.destroy());
      upstream.once("close", () => client.destroy());
      upstream.once("error", (error) => {
        remember(url, error);
        cleanup();
      });
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.on("data", (chunk) => account(chunk, url));
        upstream.on("data", (chunk) => account(chunk, url));
        client.pipe(upstream);
        upstream.pipe(client);
      });
    } catch (error) {
      if (url) remember(url, error);
      client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    proxy: {
      server: `http://127.0.0.1:${server.address().port}`,
      username,
      password,
    },
    failure(url) {
      return limitFailure || failures.get(new URL(url).hostname);
    },
    async close() {
      closing = true;
      for (const socket of sockets) socket.destroy();
      await new Promise((done) => server.close(done));
    },
  };
}
