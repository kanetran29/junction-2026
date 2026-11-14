import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../dev/fake-gateway.mjs", import.meta.url));
const PORT = 8794;
/** playwright-core from PLAYWRIGHT_CORE (or the default resolution); the browser test is skipped when it is not installed. */
const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core").catch(() => null);

test("try panel: chips fill the input; a held order becomes the manager's card; the scene follows the visitor and comes back; 375 px", { skip: !pw && "playwright-core not installed (set PLAYWRIGHT_CORE)" }, async (t) => {
  const child = spawn(process.execPath, [SERVER, "--port", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => child.kill());
  await new Promise((resolve) => child.stdout.once("data", resolve));
  const chromium = pw.chromium ?? pw.default.chromium;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.goto(`http://localhost:${PORT}/?mode=live`);
  await page.waitForSelector("#try-panel .try-chip");
  assert.equal(await page.locator("#try-panel .try-chip").count(), 4);
  await page.locator("#try-panel .try-chip").first().click();
  assert.equal(await page.inputValue("#try-text"), "1,000 litres of lactose-free milk by Monday");
  await page.click("#try-panel .try-send");
  await page.waitForSelector('.try-box[data-kind="held"]', { timeout: 15000 });
  assert.match(await page.evaluate(() => document.body.dataset.follow), /^visitor-/);
  assert.match(await page.textContent(".try-box"), /You are the kitchen manager.*Net 1,010\.00 €/s);
  await page.click(".try-decide.approve");
  await page.waitForSelector('.try-box[data-kind="accepted"]', { timeout: 15000 });

  await page.locator("#try-panel .try-chip").nth(2).click();
  await page.click("#try-panel .try-send");
  await page.waitForSelector('.try-box[data-kind="question"]', { timeout: 15000 });
  assert.equal(await page.locator(".try-choice").count(), 2);
  await page.locator(".try-choice").first().click();
  await page.waitForSelector('.try-box[data-kind="accepted"]', { timeout: 15000 });

  await page.click(".try-back");
  assert.equal(await page.evaluate(() => document.body.dataset.follow), "hotel-a");
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.ok(width[0] <= width[1], `page is ${width[0]} px wide in ${width[1]} px`);
});

test("try panel: a 429 says when to try again; a door without the sandbox (404) hides the panel", { skip: !pw && "playwright-core not installed (set PLAYWRIGHT_CORE)" }, async (t) => {
  const child = spawn(process.execPath, [SERVER, "--port", String(PORT + 10)], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => child.kill());
  await new Promise((resolve) => child.stdout.once("data", resolve));
  const chromium = pw.chromium ?? pw.default.chromium;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let reply = { status: 429, body: { error: "TRY_RATE_LIMITED", retryAfter: 12 } };
  await page.route("**/v1/try", (route) => route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) }));
  await page.goto(`http://localhost:${PORT + 10}/?mode=live`);
  await page.fill("#try-text", "20 kg of chicken breast fillet by Monday");
  await page.click("#try-panel .try-send");
  await page.waitForSelector('.try-box[data-kind="error"]');
  assert.equal((await page.textContent('.try-box[data-kind="error"] .try-title')).trim(), "Busy: try again in 12 s");
  reply = { status: 404, body: { error: "not found" } };
  await page.click("#try-panel .try-send");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("try-panel")).display === "none");
});
