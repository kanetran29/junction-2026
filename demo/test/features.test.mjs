import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pickMime, voiceViewOf, postVoice, getPeppol, PEPPOL_ROUTE, VOICE_MAX_S } from "../try.mjs";
import { hasRoute, answers } from "../features.mjs";

const SERVER = fileURLToPath(new URL("../dev/fake-gateway.mjs", import.meta.url));
const PORT = 8764;
/** playwright-core from PLAYWRIGHT_CORE (or the default resolution); the browser tests are skipped when it is not installed. */
const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core").catch(() => null);
const skip = !pw && "playwright-core not installed (set PLAYWRIGHT_CORE)";

test("voice, Peppol and route checks: replies read plainly, uploads and downloads carry the visitor", async () => {
  assert.equal(pickMime((t) => t === "audio/mp4"), "audio/mp4", "Safari records mp4");
  assert.equal(pickMime((t) => t.startsWith("audio/webm")), "audio/webm;codecs=opus");
  assert.equal(pickMime(() => false), "");
  assert.deepEqual(voiceViewOf({ status: 200, body: { transcript: "  20 kg of chicken  " } }), { kind: "transcript", text: "20 kg of chicken" });
  assert.match(voiceViewOf({ status: 200, body: { transcript: "" } }).title, /^No words came through/);
  assert.match(voiceViewOf({ status: 400, body: { error: "AUDIO_UNCLEAR" } }).title, /not clear enough/);
  assert.equal(voiceViewOf({ status: 413, body: null }).title, `Too long: keep a voice request under ${VOICE_MAX_S} s.`);
  assert.equal(voiceViewOf({ status: 404, body: null }).kind, "hide-voice");
  assert.deepEqual([voiceViewOf({ status: 429, body: { retryAfter: 5 }, retryAfter: 5 }).wait, voiceViewOf({ status: 503, body: { error: "MODELS_BUSY" } }).examples], [5, true]);
  assert.equal(voiceViewOf({ status: 0, body: null }).title, "The door did not answer. Try again.");

  let sent;
  const voice = await postVoice("http://door/", new Blob(["x"], { type: "audio/webm" }), "v-1", async (url, init) => {
    sent = { url, form: init.body };
    return new Response(JSON.stringify({ transcript: "hi" }), { status: 200 });
  });
  assert.deepEqual([voice.status, voice.body.transcript, sent.url], [200, "hi", "http://door/v1/try/voice"]);
  assert.deepEqual([sent.form.get("visitor"), sent.form.get("audio").name], ["v-1", "voice.webm"]);

  let headers;
  const xml = await getPeppol("http://door", "o 1", "v-1", async (url, init) => {
    headers = { url, ...init.headers };
    return new Response("<Order/>", { status: 200 });
  });
  assert.deepEqual([xml.status, await xml.blob.text(), headers.url, headers.Authorization], [200, "<Order/>", "http://door/v1/orders/o%201/peppol", "Bearer v-1"]);
  assert.equal((await getPeppol("http://door", "o1", "v", async () => new Response("", { status: 404 }))).blob, null);

  const doc = async () => new Response(JSON.stringify({ paths: { "/v1/try/voice": {}, "/v1/orders/{orderId}/peppol": {} } }), { status: 200 });
  assert.equal(await hasRoute("http://a", "/v1/try/voice", doc), true);
  assert.equal(await hasRoute("http://a", PEPPOL_ROUTE, doc), true);
  assert.equal(await hasRoute("http://b", "/v1/try/voice", async () => new Response("", { status: 404 })), false);
  assert.equal(await answers("http://c", "/.well-known/oauth-authorization-server", async () => new Response("", { status: 404 })), false);
});

/** A fake door in the browser: which new routes exist, and what the voice route answers next. */
function door(page, { voice = true, peppol = true, oauth = true } = {}) {
  const state = { voiceReply: { status: 200, body: { transcript: "20 kg of chicken breast fillet by Monday" } }, voicePosts: [], peppolAuth: [] };
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  page.route("**/openapi.json", (route) => json(route, 200, { paths: { "/v1/try": {}, ...(voice ? { "/v1/try/voice": {} } : {}), ...(peppol ? { "/v1/orders/{orderId}/peppol": {} } : {}) } }));
  page.route("**/.well-known/oauth-authorization-server", (route) => (oauth ? json(route, 200, { issuer: "https://door" }) : json(route, 404, { error: "not found" })));
  page.route("**/v1/try/voice", (route) => {
    state.voicePosts.push(route.request().headers()["content-type"] ?? "");
    return json(route, state.voiceReply.status, state.voiceReply.body);
  });
  page.route("**/v1/try", (route) => json(route, 200, { visitor: "v-test", buyerId: "visitor-0000feed", step: "decided", draft: { id: "d1" }, order: { orderId: "o-1", state: "ACCEPTED", netCents: 15400, grossCents: 17400, reasons: [] } }));
  page.route("**/v1/orders/*/peppol", (route) => {
    state.peppolAuth.push(route.request().headers().authorization);
    return peppol ? route.fulfill({ status: 200, contentType: "application/xml", body: "<Order/>" }) : json(route, 404, { error: "not found" });
  });
  return state;
}

/** Starts the dev server and a browser with a fake microphone; returns { browser, url }. */
async function setup(t, port) {
  const child = spawn(process.execPath, [SERVER, "--port", String(port)], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => child.kill());
  await new Promise((resolve) => child.stdout.once("data", resolve));
  const chromium = pw.chromium ?? pw.default.chromium;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  t.after(() => browser.close());
  return { browser, url: `http://localhost:${port}/` };
}

test("voice in Try it: records with a timer, fills the input without sending, and reads every failure plainly", { skip }, async (t) => {
  const { browser, url } = await setup(t, PORT);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const state = door(page);
  await page.goto(`${url}?mode=live`);
  const mic = page.locator("#try-panel .try-mic");
  await mic.waitFor({ state: "visible" });
  assert.equal(await mic.getAttribute("aria-label"), "Speak your request");
  const title = () => page.textContent("#try-panel .try-status .try-title").then((x) => x.trim());
  const record = async () => {
    await mic.click();
    await page.waitForSelector('#try-panel .try-mic[aria-pressed="true"]');
    assert.match(await page.textContent("#try-panel .try-mic-time"), /^0:0\d \/ 0:30$/);
    assert.equal(await page.isDisabled("#try-panel .try-send"), true, "Send waits while recording");
    await page.waitForTimeout(1200);
    await mic.click();
    await page.waitForSelector('#try-panel .try-mic[aria-pressed="false"]');
  };

  await record();
  await page.waitForFunction(() => document.getElementById("try-text").value.length > 0);
  assert.equal(await page.inputValue("#try-text"), "20 kg of chicken breast fillet by Monday");
  assert.equal(await page.locator("#try-panel .try-thread > li").count(), 0, "never sent by itself");
  assert.match(await page.textContent("#try-panel .try-voice-note"), /check it/);
  assert.match(state.voicePosts[0], /^multipart\/form-data/);

  for (const [reply, expected] of [
    [{ status: 400, body: { error: "AUDIO_UNCLEAR" } }, /^The recording was not clear enough/],
    [{ status: 413, body: { error: "TOO_LONG" } }, /^Too long: keep a voice request under 30 s\.$/],
    [{ status: 503, body: { error: "MODELS_BUSY", retryAfter: 20 } }, /^The models are busy right now/],
    [{ status: 429, body: { error: "TRY_RATE_LIMITED", retryAfter: 2 } }, /^Busy: try again in 2 s$/],
  ]) {
    state.voiceReply = reply;
    await record();
    await page.waitForSelector('#try-panel .try-status .try-box[data-kind="error"]');
    assert.match(await title(), expected);
  }
  assert.equal(await page.isDisabled("#try-panel .try-send"), true, "429 counts down with Send off");
  await page.waitForFunction(() => !document.querySelector("#try-panel .try-send").disabled, null, { timeout: 4000 });

  state.voiceReply = { status: 404, body: { error: "not found" } };
  await record();
  await page.waitForSelector("#try-panel .try-mic", { state: "hidden" });
  assert.match(await title(), /^Voice is not available on this door/);
});

test("voice in Try it: a blocked microphone says so; no recorder or no voice route hides the button", { skip }, async (t) => {
  const { browser, url } = await setup(t, PORT + 1);
  const denied = await browser.newPage();
  door(denied);
  await denied.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  await denied.goto(`${url}?mode=live`);
  await denied.locator("#try-panel .try-mic").click();
  await denied.waitForSelector('#try-panel .try-status .try-box[data-kind="error"]');
  assert.match(await denied.textContent("#try-panel .try-status .try-title"), /^The microphone is blocked for this page/);

  const old = await browser.newPage();
  door(old);
  await old.addInitScript(() => delete window.MediaRecorder);
  await old.goto(`${url}?mode=live`);
  await old.waitForSelector("#try-panel .try-chip");
  await old.waitForTimeout(500);
  assert.equal(await old.isHidden("#try-panel .try-mic"), true, "no MediaRecorder: no button");

  const noRoute = await browser.newPage();
  door(noRoute, { voice: false });
  await noRoute.goto(`${url}?mode=live`);
  await noRoute.waitForSelector("#try-panel .try-chip");
  await noRoute.waitForTimeout(500);
  assert.equal(await noRoute.isHidden("#try-panel .try-mic"), true, "no /v1/try/voice: no button");
});

test("Peppol on an accepted order, and Connect Claude in Live, Inside and the Deck notes, each only where the door has it", { skip }, async (t) => {
  const { browser, url } = await setup(t, PORT + 2);
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const state = door(page);
  await page.goto(`${url}?mode=live`);
  await page.fill("#try-text", "20 kg of chicken breast fillet by Monday");
  await page.click("#try-panel .try-send");
  const link = page.locator("#try-panel .try-peppol");
  await link.waitFor();
  assert.deepEqual([await link.textContent(), await link.getAttribute("download")], ["Peppol order (UBL XML)", "lazydoor-order-o-1.xml"]);
  assert.equal((await page.textContent("#try-panel .try-peppol-note")).trim(), "Peppol BIS Order 3.0, the format Finnish kitchens' systems already exchange. Export only; nothing is sent.");
  assert.deepEqual(state.peppolAuth, ["Bearer v-test"]);
  await page.waitForSelector("#connect-panel:not([hidden])");
  assert.equal((await page.textContent("#connect-panel h2")).trim(), "Connect Claude");
  assert.equal((await page.textContent("#connect-panel code")).trim(), "https://lazydoor.lazydoor.workers.dev/mcp");
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.ok(width[0] <= width[1], `page is ${width[0]} px wide in ${width[1]} px`);

  await page.goto(`${url}?mode=inside`);
  await page.waitForSelector('[data-section="connect"]:not([hidden])');
  await page.waitForSelector(".peppol-line:not([hidden])");
  assert.match(await page.textContent(".peppol-line"), /^Peppol export: Peppol BIS Order 3\.0/);
  await page.goto(`${url}?mode=deck`);
  await page.waitForSelector(".deck-connect", { state: "attached" });
  assert.equal(await page.$$eval(".deck-slide", (lis) => lis.findIndex((li) => li.querySelector(".deck-connect"))), 5, "on the demo slide's notes");

  const bare = await browser.newPage();
  door(bare, { voice: false, peppol: false, oauth: false });
  await bare.goto(`${url}?mode=live`);
  await bare.fill("#try-text", "20 kg of chicken breast fillet by Monday");
  await bare.click("#try-panel .try-send");
  await bare.waitForSelector('#try-panel .try-box[data-kind="accepted"]');
  await bare.waitForTimeout(400);
  assert.equal(await bare.locator("#try-panel .try-peppol").count(), 0, "a 404 on the Peppol route shows no link");
  assert.equal(await bare.isHidden("#connect-panel"), true);
  await bare.goto(`${url}?mode=inside`);
  await bare.waitForSelector('[data-section="acceptance"][data-loaded]');
  assert.deepEqual([await bare.isHidden('[data-section="connect"]'), await bare.isHidden(".peppol-line")], [true, true]);
});
