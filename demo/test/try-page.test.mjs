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

test("try panel: 429 counts down with Send off; models busy lights the examples; no answer; recorded readings; 404 hides the panel", { skip: !pw && "playwright-core not installed (set PLAYWRIGHT_CORE)" }, async (t) => {
  const child = spawn(process.execPath, [SERVER, "--port", String(PORT + 10)], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => child.kill());
  await new Promise((resolve) => child.stdout.once("data", resolve));
  const chromium = pw.chromium ?? pw.default.chromium;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let reply = { status: 429, body: { error: "TRY_RATE_LIMITED", retryAfter: 2 } };
  await page.route("**/v1/try", (route) => (reply === "abort" ? route.abort() : route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) })));
  await page.goto(`http://localhost:${PORT + 10}/?mode=live`);
  await page.fill("#try-text", "20 kg of chicken breast fillet by Monday");
  const title = () => page.textContent("#try-panel .try-box .try-title").then((x) => x.trim());
  const send = async () => {
    await page.click("#try-panel .try-send");
    await page.waitForSelector('#try-panel .try-box[data-kind="error"], #try-panel .try-box[data-kind="accepted"]');
  };

  await send();
  assert.equal(await title(), "Busy: try again in 2 s");
  assert.equal(await page.isDisabled("#try-panel .try-send"), true);
  await page.waitForFunction(() => document.querySelector("#try-panel .try-title")?.textContent === "Busy: try again in 1 s");
  await page.waitForFunction(() => !document.querySelector("#try-panel .try-send").disabled, null, { timeout: 4000 });
  assert.equal(await title(), "You can send again.");

  reply = { status: 503, body: { error: "MODELS_BUSY", retryAfter: 20 } };
  await send();
  assert.equal(await title(), "The models are busy right now. Try one of the examples, they work instantly.");
  assert.equal(await page.locator("#try-panel .try-chips[data-highlight]").count(), 1);
  assert.equal(await page.isDisabled("#try-panel .try-send"), false);

  reply = { status: 429, body: { error: "TRY_SANDBOXES_FULL", retryAfter: 60 } };
  await send();
  assert.equal(await title(), "Too many visitors right now, try again in a minute.");
  assert.equal(await page.locator("#try-panel .try-chips[data-highlight]").count(), 0);

  for (const r of [{ status: 502, body: { error: "bad gateway" } }, "abort"]) {
    reply = r;
    await send();
    assert.equal(await title(), "The door did not answer. Try again.");
  }

  reply = { status: 200, body: { visitor: "v-test", buyerId: "visitor-0000abcd", step: "decided", draft: { id: "d1", cached: true }, order: { state: "ACCEPTED", netCents: 15400, reasons: [] } } };
  await send();
  assert.equal((await page.textContent("#try-panel .try-cached")).trim(), "Example: readings recorded from Gemini and Gemma");

  assert.equal(await page.inputValue("#try-text"), "", "a sent request leaves the box for the next one");
  reply = { status: 404, body: { error: "TRY_DISABLED" } };
  await page.fill("#try-text", "20 kg of chicken breast fillet by Monday");
  await page.click("#try-panel .try-send");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("try-panel")).display === "none");
});

test("try panel: a short thread; the answer goes to the same draft, or as one sentence to a door without answers; Start over", { skip: !pw && "playwright-core not installed (set PLAYWRIGHT_CORE)" }, async (t) => {
  const child = spawn(process.execPath, [SERVER, "--port", String(PORT + 20)], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => child.kill());
  await new Promise((resolve) => child.stdout.once("data", resolve));
  const chromium = pw.chromium ?? pw.default.chromium;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const posted = [];
  let takesAnswers = true;
  const reply = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
  const base = { visitor: "v-beans", buyerId: "visitor-0000beef" };
  const accepted = { ...base, step: "decided", draft: { id: "d-done" }, order: { orderId: "o1", state: "ACCEPTED", netCents: 31000, grossCents: 35000, reasons: [] } };
  await page.route("**/v1/try", (route) => {
    const body = route.request().postDataJSON();
    posted.push(body);
    if (body.text === "slow request") return new Promise((r) => setTimeout(r, 3200)).then(() => route.fulfill(reply(200, accepted)));
    if (body.draftId) return route.fulfill(takesAnswers ? reply(200, accepted) : reply(400, { error: "BAD_REQUEST" }));
    if (body.text === "200 cans of beans") return route.fulfill(reply(200, { ...base, step: "needs_input", draft: { id: "d-beans" }, question: { field: "deliverBy", readings: [] } }));
    return route.fulfill(reply(200, accepted));
  });
  await page.goto(`http://localhost:${PORT + 20}/?mode=live`);
  const thread = () => page.$$eval("#try-panel .try-thread > li", (lis) => lis.map((li) => `${li.querySelector(".try-who").textContent}: ${(li.querySelector(".try-said") ?? li.querySelector(".try-title")).textContent}`));
  const ask = async (text, kind) => {
    await page.fill("#try-text", text);
    await page.click("#try-panel .try-send");
    await page.waitForSelector(`#try-panel .try-thread .try-box[data-kind="${kind}"]`);
  };

  await page.fill("#try-text", "slow request");
  await page.click("#try-panel .try-send");
  const current = () => page.$$eval("#try-panel .try-steps li", (lis) => lis.map((li) => li.dataset.state).join(" "));
  assert.equal(await current(), "now next next");
  assert.equal((await page.textContent('#try-panel .try-steps li[data-state="now"]')).trim(), "Reading your request…");
  await page.waitForFunction(() => document.querySelector('#try-panel .try-steps li[data-state="now"]')?.textContent === "Asking Valio…", null, { timeout: 3000 });
  assert.equal(await current(), "done now next");
  await page.waitForSelector('#try-panel .try-thread .try-box[data-kind="accepted"]');
  assert.equal(await page.locator("#try-panel .try-steps").count(), 0, "the steps go once the door answers");

  await ask("200 cans of beans", "question");
  assert.deepEqual(await thread(), ["You: 200 cans of beans", "Lazydoor: When should it arrive?"]);
  assert.equal((await page.textContent("#try-panel .try-label")).trim(), "Your answer");
  assert.equal(await page.getAttribute("#try-text", "placeholder"), "When should it arrive?");
  await ask("next tuesday", "accepted");
  assert.deepEqual(posted.at(-1), { visitor: "v-beans", draftId: "d-beans", answer: { text: "next tuesday" } });
  assert.deepEqual((await thread()).slice(0, 3), ["You: 200 cans of beans", "Lazydoor: When should it arrive?", "You: next tuesday"]);
  assert.match((await thread())[3], /^Lazydoor: Accepted: 310\.00 € net/);
  assert.equal((await page.textContent("#try-panel .try-label")).trim(), "Your request, as the chef");

  takesAnswers = false;
  await ask("200 cans of beans", "question");
  assert.equal((await thread()).length, 2, "a new request starts a new thread");
  const before = posted.length;
  await ask("next tuesday", "accepted");
  assert.deepEqual(posted.slice(before), [{ visitor: "v-beans", draftId: "d-beans", answer: { text: "next tuesday" } }, { text: "200 cans of beans, next tuesday", visitor: "v-beans" }]);
  assert.equal((await thread()).length, 4);

  await page.click("#try-panel .try-restart");
  assert.equal(await page.locator("#try-panel .try-thread > li").count(), 0);
  assert.equal(await page.isVisible("#try-panel .try-empty"), true);
  assert.equal(await page.isVisible("#try-panel .try-restart"), false);
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.ok(width[0] <= width[1], `page is ${width[0]} px wide in ${width[1]} px`);
});
