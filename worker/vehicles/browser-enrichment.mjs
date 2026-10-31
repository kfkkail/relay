import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { safePageUrl, sellerPageAttributes } from "./detail-enrichment.mjs";
import { SellerPageError, sellerPageError } from "./seller-error.mjs";
import { startBrowserProxy } from "./browser-proxy.mjs";

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

export function configurationEvidence(text, vin, url) {
  const content = String(text).slice(0, MAX_BYTES);
  // A listing link is not proof of identity. Require the VIN in the rendered
  // page, and reject pages that mix several vehicles or contradictory labels.
  const vins = new Set(content.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g));
  if (!vins.has(vin) || vins.size !== 1) return {};
  const attributes = sellerPageAttributes(content, url);
  const motors = new Set(
    [
      ...content.matchAll(
        /\b(dual|quad|tri)[ -]?(?:electric[ -]?)?motors?\b/gi,
      ),
    ].map((m) => m[1].toLowerCase()),
  );
  const motor = motors.size === 1 ? [...motors][0] : null;
  const match = motor
    ? /\b(dual|quad|tri)[ -]?(?:electric[ -]?)?motors?\b/i.exec(content)
    : null;
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
    startProxy = startBrowserProxy,
    ensureBrowser = ensureChromium,
    headless = process.env.RELAY_VEHICLE_BROWSER_HEADLESS !== "0",
  } = {},
) {
  safePageUrl(url);
  await ensureBrowser();
  const network = await startProxy();
  let browser;
  try {
    browser = await launch({
      headless,
      channel: "chromium",
      chromiumSandbox: true,
      proxy: network.proxy,
      args: [
        "--proxy-bypass-list=<-loopback>",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--disable-quic",
      ],
      timeout: 15_000,
    });
  } catch (error) {
    await network.close();
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
    void browser.close().catch(() => {});
  }, 45_000);
  let limitFailure;
  try {
    const context = await browser.newContext({
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    const page = await context.newPage();
    let requests = 0;
    await context.route("**/*", async (route) => {
      const request = route.request();
      try {
        safePageUrl(request.url());
        if (
          !["GET", "HEAD", "POST", "OPTIONS"].includes(request.method()) ||
          ![
            "document",
            "script",
            "stylesheet",
            "xhr",
            "fetch",
            "image",
            "font",
          ].includes(request.resourceType()) ||
          (request.method() === "POST" &&
            !["xhr", "fetch"].includes(request.resourceType())) ||
          request.frame().page() !== page
        )
          return await route.abort();
        if (++requests > 180) {
          limitFailure ??= new SellerPageError("request_limit", url);
          return await route.abort();
        }
        // No Node fetch or response substitution: browser TLS/HTTP and its
        // isolated cookie jar remain intact through the public-only tunnel.
        await route.continue();
      } catch {
        await route.abort().catch(() => {});
      }
    });
    let response;
    try {
      response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 25_000,
      });
    } catch (error) {
      throw network.failure(url) || limitFailure || sellerPageError(error, url);
    }
    if (!response) throw new SellerPageError("network_error", url);
    const status = response.status();
    if (!response.ok())
      throw new SellerPageError(
        [401, 403].includes(status)
          ? "access_denied"
          : status === 429
            ? "rate_limited"
            : "http_error",
        response.url(),
        { httpStatus: status },
      );
    // Allow client-rendered configuration to settle, within the overall bound.
    await page
      .waitForLoadState("networkidle", { timeout: 5_000 })
      .catch(() => {});
    await openSellerSpecs(page);
    await page
      .waitForLoadState("networkidle", { timeout: 3000 })
      .catch(() => {});
    if (limitFailure || network.failure(url))
      throw limitFailure || network.failure(url);
    // Some sites return a challenge with HTTP 200. Report it, never solve it.
    if (
      await page
        .locator("body")
        .innerText({ timeout: 2_000 })
        .then((text) =>
          /(?:verify you are human|enable javascript and cookies to continue|checking your browser|performing security verification|security service to protect against malicious bots)/i.test(
            text,
          ),
        )
    )
      throw new SellerPageError("access_denied", url);
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
    await network.close();
  }
}

export async function openSellerSpecs(page) {
  // Exact, read-only controls only; never click Get Started, Notify Me, buy,
  // sign-in or challenge controls. An absent panel is normal on other sellers.
  const specs = page
    .getByRole("button", {
      name: /^(?:view all features and specs|view all features & specs|view full specs|view specifications)$/i,
    })
    .first();
  if (
    await specs
      .waitFor({ state: "visible", timeout: 4000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await specs.click({ timeout: 4000 });
    const tab = page.getByRole("tab", { name: /^specs$/i }).first();
    if (
      await tab
        .waitFor({ state: "visible", timeout: 2000 })
        .then(() => true)
        .catch(() => false)
    ) {
      const previous = await page.locator("body").innerText({ timeout: 2000 });
      await tab.click({ timeout: 3000 });
      // A settled navigation's networkidle state can already be true while a
      // tab starts a new fetch. Wait for the tab's rendered text instead.
      await page
        .waitForFunction(
          (before) => document.body.innerText !== before,
          previous,
          { timeout: 4000 },
        )
        .catch(() => {});
    }
  }
}
