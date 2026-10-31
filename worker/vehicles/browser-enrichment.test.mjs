import { describe, expect, it, vi } from "vitest";
import {
  configurationEvidence,
  ensureChromium,
  enrichVehicle,
  fetchPublicResource,
} from "./browser-enrichment.mjs";
import { assertPublicHost } from "./detail-enrichment.mjs";

const vin = "7FCTGAAA0NN000001";
const url = "https://dealer.example/truck";
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

describe("public browser resources", () => {
  it("validates each redirect and never forwards cookies or credentials", async () => {
    const validateHost = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://other.example/listing" },
        }),
      )
      .mockResolvedValueOnce(new Response("R1T"));
    expect(
      (await fetchPublicResource(url, { fetchImpl, validateHost })).body,
    ).toBe("R1T");
    expect(validateHost.mock.calls.map(([u]) => u.hostname)).toEqual([
      "dealer.example",
      "other.example",
    ]);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      redirect: "manual",
      headers: { "User-Agent": "Relay vehicle research/1.0" },
    });
    expect(Object.keys(fetchImpl.mock.calls[0][1].headers)).toHaveLength(1);
  });
  it("blocks private redirects before fetching them", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/admin" },
        }),
    );
    const validateHost = (u) =>
      assertPublicHost(u, async () => [
        { address: u.hostname === "dealer.example" ? "8.8.8.8" : "127.0.0.1" },
      ]);
    await expect(
      fetchPublicResource(url, { fetchImpl, validateHost }),
    ).rejects.toThrow("unsafe_address");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("bounds page size, redirects and failed responses", async () => {
    const options = { validateHost: async () => {} };
    await expect(
      fetchPublicResource(url, {
        ...options,
        fetchImpl: async () => new Response("x".repeat(1_500_001)),
      }),
    ).rejects.toThrow("seller_page_too_large");
    await expect(
      fetchPublicResource(url, {
        ...options,
        fetchImpl: async () => new Response(null, { status: 403 }),
      }),
    ).rejects.toThrow("seller_page_unavailable");
    await expect(
      fetchPublicResource(url, {
        ...options,
        fetchImpl: async () =>
          new Response(null, { status: 302, headers: { location: "/loop" } }),
      }),
    ).rejects.toThrow("unsafe_redirect");
    await expect(
      fetchPublicResource("http://localhost/truck", options),
    ).rejects.toThrow("unsafe_url");
  });
});

// Opt-in real Chromium test. Network responses are fixtures, so this checks
// JavaScript rendering and request blocking without contacting a seller.
it.skipIf(process.env.RELAY_BROWSER_TESTS !== "1")(
  "extracts client-rendered details using real Chromium",
  async () => {
    const requests = [];
    const resource = async (requestUrl) => {
      requests.push(requestUrl);
      const script = requestUrl.endsWith("/app.js");
      return {
        url: requestUrl,
        contentType: script ? "text/javascript" : "text/html",
        body: script
          ? `document.body.append(' ${vin} Large Pack Quad-Motor'); fetch('/write', {method:'POST'});`
          : '<html><body><script src="/app.js"></script><img src="/photo.jpg"></body></html>',
      };
    };
    expect(
      await enrichVehicle({ detail_vin: vin, detail_url: url }, { resource }),
    ).toMatchObject({ battery_pack: "large", motor: "quad" });
    expect(requests).toEqual([url, "https://dealer.example/app.js"]);
  },
  30000,
);
