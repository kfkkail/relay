import { chromium } from "playwright";

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("data:text/html,<title>Relay browser ready</title>");
  if ((await page.title()) !== "Relay browser ready") {
    throw new Error("Chromium returned an unexpected smoke-test page.");
  }
  console.log("Relay worker browser is ready.");
} finally {
  await browser?.close();
}
