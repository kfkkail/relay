import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  assertPublicHost,
  boundedText,
  isPublicAddress,
  safePageUrl,
  sellerPageAttributes,
} from "./detail-enrichment.mjs";
import { SellerPageError, sellerPageError } from "./seller-error.mjs";

const MAX_BYTES = 1_500_000;
const run = promisify(execFile);
let provisioning;

// A worker first upgraded by the old updater may have the npm package but no
// browser. Repair that on the first configuration job, without requiring a
// service reinstall. Concurrent jobs share the download; failures can retry.
export async function ensureChromium({
  check = () => access(chromium.executablePath(), constants.X_OK),
  install = () =>
    run(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../node_modules/playwright/cli.js", import.meta.url),
        ),
        "install",
        "chromium",
      ],
      { timeout: 10 * 60_000 },
    ),
} = {}) {
  if (!provisioning) {
    provisioning = (async () => {
      try {
        await check();
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await install();
        await check();
      }
    })().finally(() => {
      provisioning = undefined;
    });
  }
  await provisioning;
}

// Resolve and validate at connection time too, pinning the approved address so
// a DNS change between the preflight check and connection cannot reach a LAN.
function publicFetch(url, { headers, signal }) {
  return new Promise((resolve, reject) => {
    const request = (
      new URL(url).protocol === "https:" ? httpsRequest : httpRequest
    )(
      url,
      {
        headers,
        signal,
        agent: false,
        autoSelectFamily: false,
        lookup(hostname, options, callback) {
          lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
            if (
              !addresses.length ||
              addresses.some(({ address }) => !isPublicAddress(address))
            )
              return callback(new Error("unsafe_address"));
            const address = addresses[0];
            callback(null, address.address, address.family);
          }, callback);
        },
      },
      (response) => {
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (value)
            responseHeaders.set(
              key,
              Array.isArray(value) ? value.join(", ") : value,
            );
        }
        const status = response.statusCode;
        resolve(
          new Response(
            [204, 304].includes(status) ? null : Readable.toWeb(response),
            { status, headers: responseHeaders },
          ),
        );
        if ([204, 304].includes(status)) response.resume();
      },
    );
    request.on("error", reject);
    request.end();
  });
}

// Fetch every browser resource ourselves: redirects receive the same URL/DNS
// checks as the original page, and page scripts never receive worker secrets,
// cookies, authorization headers or access to private network addresses.
export async function fetchPublicResource(
  initialUrl,
  {
    fetchImpl = publicFetch,
    validateHost = assertPublicHost,
    signal,
    onBytes,
  } = {},
) {
  let url = safePageUrl(initialUrl);
  for (let redirects = 0; redirects <= 3; redirects++) {
    await validateHost(url);
    const response = await fetchImpl(url.href, {
      redirect: "manual",
      headers: { "User-Agent": "Relay vehicle research/1.0" },
      signal: AbortSignal.any([
        AbortSignal.timeout(10_000),
        ...(signal ? [signal] : []),
      ]),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects === 3) throw new Error("unsafe_redirect");
      url = safePageUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new SellerPageError(
        [401, 403].includes(response.status)
          ? "access_denied"
          : response.status === 429
            ? "rate_limited"
            : "http_error",
        url.href,
        { httpStatus: response.status },
      );
    }
    const body = await boundedText(response, MAX_BYTES, onBytes);
    // Preserve the final base for relative scripts on redirected pages.
    const contentType = response.headers.get("content-type") || "text/plain";
    return { body, contentType, url: url.href };
  }
  throw new Error("unsafe_redirect");
}

export function configurationEvidence(text, vin, url) {
  const content = String(text).slice(0, MAX_BYTES);
  // A listing link is not proof of identity. Require the VIN in the rendered
  // page, and reject pages that mix several vehicles or contradictory labels.
  const vins = new Set(content.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g));
  if (!vins.has(vin) || vins.size !== 1) return {};
  const attributes = sellerPageAttributes(content, url);
  const motors = new Set(
    [...content.matchAll(/\b(dual|quad|tri)[ -]?motor\b/gi)].map((m) =>
      m[1].toLowerCase(),
    ),
  );
  const motor = motors.size === 1 ? [...motors][0] : null;
  const match = motor ? /\b(dual|quad|tri)[ -]?motor\b/i.exec(content) : null;
  return {
    battery_pack: attributes.battery_pack,
    battery_evidence: attributes.battery_evidence,
    motor,
    motor_evidence: match
      ? `Seller page (${new URL(url).hostname}): ${content.slice(Math.max(0, match.index - 100), match.index + 220)}`
      : null,
  };
}

export async function enrichVehicle(
  { detail_url: url, detail_vin: vin },
  {
    launch = (options) => chromium.launch(options),
    resource = fetchPublicResource,
    ensureBrowser = ensureChromium,
  } = {},
) {
  safePageUrl(url);
  await ensureBrowser();
  const browser = await launch({
    headless: true,
    channel: "chromium",
    chromiumSandbox: true,
    args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
    timeout: 15_000,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
    void browser.close().catch(() => {});
  }, 25_000);
  let limitFailure;
  try {
    const context = await browser.newContext({
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    const page = await context.newPage();
    let requests = 0;
    let bytes = 0;
    let documentFailure;
    await context.route("**/*", async (route) => {
      const request = route.request();
      let mainDocument = false;
      try {
        const frame = request.frame();
        mainDocument =
          request.isNavigationRequest() && frame === page.mainFrame();
        if (
          request.method() !== "GET" ||
          !["document", "script", "stylesheet", "xhr", "fetch"].includes(
            request.resourceType(),
          ) ||
          frame !== page.mainFrame()
        )
          return await route.abort();
        if (++requests > 40) {
          limitFailure ??= new SellerPageError("request_limit", url);
          return await route.abort();
        }
        const result = await resource(request.url(), {
          signal: controller.signal,
          onBytes(chunkBytes) {
            bytes += chunkBytes;
            if (bytes > 5_000_000) {
              limitFailure ??= new SellerPageError("response_too_large", url);
              controller.abort();
              throw limitFailure;
            }
          },
        });
        // Never let an upstream redirect escape our network checks. A base
        // element preserves relative links without another browser navigation.
        const body =
          request.resourceType() === "document"
            ? `<base href="${result.url.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">${result.body}`
            : result.body;
        await route.fulfill({
          status: 200,
          contentType: result.contentType,
          body,
        });
      } catch (error) {
        if (mainDocument)
          documentFailure ??= sellerPageError(error, request.url());
        await route.abort().catch(() => {});
      }
    });
    let response;
    try {
      response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
    } catch (error) {
      throw documentFailure || limitFailure || sellerPageError(error, url);
    }
    if (!response?.ok()) throw new Error("seller_page_unavailable");
    // Allow client-rendered configuration to settle, within the overall bound.
    await page
      .waitForLoadState("networkidle", { timeout: 5_000 })
      .catch(() => {});
    if (limitFailure) throw limitFailure;
    const text = await page.locator("body").innerText({ timeout: 2_000 });
    return configurationEvidence(text, vin, url);
  } catch (error) {
    if (limitFailure) throw limitFailure;
    if (controller.signal.aborted || error?.name === "TimeoutError")
      throw new SellerPageError("timeout", url);
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
    await browser.close().catch(() => {});
  }
}
