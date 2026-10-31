import { describe, expect, it, vi } from "vitest";
import {
  configurationEvidence,
  ensureChromium,
  enrichVehicle,
} from "./browser-enrichment.mjs";
import { SellerPageError, sellerPageError } from "./seller-error.mjs";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { startBrowserProxy } from "./browser-proxy.mjs";

const vin = "7FCTGAAA0NN000001";
const url = "https://dealer.example/truck";
const nativeHttpFailure = (status, target) =>
  enrichVehicle(
    { detail_url: target, detail_vin: vin },
    {
      ensureBrowser: async () => {},
      startProxy: async () => ({
        proxy: {},
        failure: () => undefined,
        close: async () => {},
      }),
      launch: async () => ({
        close: async () => {},
        newContext: async () => ({
          routeWebSocket: async () => {},
          route: async () => {},
          newPage: async () => ({
            goto: async () => ({
              ok: () => false,
              status: () => status,
              url: () => target,
            }),
          }),
        }),
      }),
    },
  );
describe("browser bootstrap after an older worker auto-update", () => {
  it("shares a missing-browser install across concurrent jobs and skips an existing browser", async () => {
    let ready = false;
    const check = vi.fn(async () => {
      if (!ready) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    const install = vi.fn(async () => {
      ready = true;
    });
    await Promise.all([
      ensureChromium({ check, install }),
      ensureChromium({ check, install }),
    ]);
    expect(install).toHaveBeenCalledOnce();
    await ensureChromium({ check, install });
    expect(install).toHaveBeenCalledOnce();
  });
  it("retries a failed download on the next job", async () => {
    let ready = false;
    const check = async () => {
      if (!ready) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    };
    const install = vi
      .fn()
      .mockRejectedValueOnce(new Error("download failed"))
      .mockImplementationOnce(async () => {
        ready = true;
      });
    await expect(ensureChromium({ check, install })).rejects.toThrow(
      "download failed",
    );
    await ensureChromium({ check, install });
    expect(install).toHaveBeenCalledTimes(2);
  });
});
describe("targeted configuration evidence", () => {
  it("requires the exact VIN and explicit labels, and retains evidence", () => {
    expect(
      configurationEvidence(`${vin} Engine Quad Electric Motors`, vin, url)
        .motor,
    ).toBe("quad");
    expect(
      configurationEvidence(`${vin} Adventure Large Pack Quad-Motor`, vin, url),
    ).toMatchObject({
      battery_pack: "large",
      motor: "quad",
      battery_evidence: expect.stringContaining("Large Pack"),
      motor_evidence: expect.stringContaining("Quad-Motor"),
    });
    expect(configurationEvidence("Large Pack Quad-Motor", vin, url)).toEqual(
      {},
    );
    expect(configurationEvidence(`${vin} Adventure`, vin, url)).toMatchObject({
      battery_pack: null,
      motor: null,
    });
  });
  it("does not accept other vehicles or contradictory configurations", () => {
    expect(
      configurationEvidence(
        `${vin} 7FCTGAAA0NN000002 Large Pack Quad-Motor`,
        vin,
        url,
      ),
    ).toEqual({});
    expect(
      configurationEvidence(
        `${vin} Large Pack Max Pack Dual-Motor Quad-Motor`,
        vin,
        url,
      ),
    ).toMatchObject({ battery_pack: null, motor: null });
  });
});

describe("seller failure diagnostics", () => {
  it.each([
    [401, "access_denied"],
    [403, "access_denied"],
    [429, "rate_limited"],
    [404, "http_error"],
    [503, "http_error"],
  ])(
    "preserves HTTP %s without response bodies or query parameters",
    async (status, code) => {
      const error = await nativeHttpFailure(
        status,
        `${url}?token=private`,
      ).catch((e) => e);
      expect(error).toBeInstanceOf(SellerPageError);
      expect(error.diagnostic).toEqual({
        code,
        host: "dealer.example",
        http_status: status,
      });
      expect(error.message).toContain(`HTTP ${status}`);
      expect(error.message).not.toMatch(/private|secret|token/);
    },
  );
  it("retains connection failure codes and classifies unsafe URLs and timeouts", () => {
    expect(
      sellerPageError(
        Object.assign(new Error("private details"), { code: "ECONNRESET" }),
        url,
      ).diagnostic,
    ).toEqual({
      code: "network_error",
      host: "dealer.example",
      network_code: "ECONNRESET",
    });
    expect(
      sellerPageError(new DOMException("secret", "TimeoutError"), url)
        .diagnostic.code,
    ).toBe("timeout");
    expect(
      sellerPageError(new Error("unsafe_address"), url).diagnostic.code,
    ).toBe("unsafe_destination");
  });
  it("retains native HTTP failure status and cleans up Chromium and proxy", async () => {
    const page = {
      mainFrame: () => "main",
      goto: async () => ({
        ok: () => false,
        status: () => 403,
        url: () => url,
      }),
    };
    const close = vi.fn(async () => {});
    const context = {
      routeWebSocket: async () => {},
      newPage: async () => page,
      route: async () => {},
    };
    const proxyClose = vi.fn(async () => {});
    const error = await enrichVehicle(
      { detail_url: url, detail_vin: vin },
      {
        ensureBrowser: async () => {},
        launch: async () => ({ newContext: async () => context, close }),
        startProxy: async () => ({
          proxy: {},
          failure: () => undefined,
          close: proxyClose,
        }),
      },
    ).catch((e) => e);
    expect(error.message).toBe(
      "dealer.example: seller denied automated access (HTTP 403)",
    );
    expect(close).toHaveBeenCalledOnce();
    expect(proxyClose).toHaveBeenCalledOnce();
  });
});

// Real native HTTP through the proxy, not route.fulfill: cookies gate the API
// and configuration only appears after the specs button and tab are clicked.
it.skipIf(process.env.RELAY_BROWSER_TESTS !== "1")(
  "uses native Chromium cookies, JavaScript, POST data and specs-panel clicks",
  async () => {
    let cookieSeen = false;
    const seen = [];
    const fixture = createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      if (req.url === "/specs") {
        cookieSeen = req.headers.cookie === "session=fixture";
        res.writeHead(cookieSeen ? 200 : 403, {
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify({ text: "Large Pack Quad Electric Motors" }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Set-Cookie": "session=fixture; Path=/; HttpOnly",
      });
      res.end(
        `<html><body><p>${vin}</p><button onclick="document.querySelector('[role=tab]').hidden=false">View All Features and Specs</button><button role="tab" hidden onclick="fetch('/specs',{method:'POST'}).then(r=>r.json()).then(d=>{document.querySelector('#result').textContent=d.text})">Specs</button><section id="result"></section></body></html>`,
      );
    });
    fixture.listen(0, "127.0.0.1");
    await once(fixture, "listening");
    const startProxy = () =>
      startBrowserProxy({
        resolve: async () => [{ address: "8.8.8.8", family: 4 }],
        httpRequestImpl: (options, cb) =>
          httpRequest(
            { ...options, hostname: "127.0.0.1", port: fixture.address().port },
            cb,
          ),
      });
    try {
      const result = await enrichVehicle(
        { detail_vin: vin, detail_url: "http://dealer.example/truck" },
        { startProxy },
      );
      expect(cookieSeen, JSON.stringify(seen)).toBe(true);
      expect(result).toMatchObject({ battery_pack: "large", motor: "quad" });
    } finally {
      fixture.closeAllConnections();
      await new Promise((done) => fixture.close(done));
    }
  },
  60000,
);
