import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pickMime, voiceViewOf, postVoice, getPeppol, PEPPOL_CAPTION, VOICE_MAX_S, VOICE_MAX_BYTES } from "../try.mjs";
import { voiceOn, peppolOn, connectorOn, featuresOn } from "../features.mjs";
import { FEATURE_ROWS } from "../compare.mjs";
import { WAYS } from "../ways.mjs";

const SERVER = fileURLToPath(new URL("../dev/fake-gateway.mjs", import.meta.url));
const PORT = 8764;
/** playwright-core from PLAYWRIGHT_CORE (or the default resolution); the browser tests are skipped when it is not installed. */
const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core").catch(() => null);
const skip = !pw && "playwright-core not installed (set PLAYWRIGHT_CORE)";

test("voice, Peppol and the feature checks follow the door's contract", async () => {
  assert.equal(pickMime((t) => t === "audio/mp4"), "audio/mp4", "Safari records mp4");
  assert.equal(pickMime((t) => t.startsWith("audio/webm")), "audio/webm;codecs=opus");
  assert.equal(pickMime(() => false), "");
  const v = (status, body, retryAfter = null) => voiceViewOf({ status, body, retryAfter });
  assert.deepEqual(v(200, { transcript: "  20 kg of chicken  " }), { kind: "transcript", text: "20 kg of chicken" });
  assert.match(v(400, { error: "TRANSCRIPT_EMPTY" }).title, /^No words came through/);
  assert.equal(v(404, { error: "VISITOR_UNKNOWN" }).kind, "stale-visitor");
  assert.equal(v(404, { error: "NOT_FOUND" }).kind, "hide-voice");
  assert.equal(v(413, { error: "PAYLOAD_TOO_LARGE" }).title, `Too long: keep a voice request under ${VOICE_MAX_S} s.`);
  assert.match(v(415, { error: "UNSUPPORTED_MEDIA_TYPE" }).title, /format the door does not take/);
  assert.match(v(503, { error: "MODEL_UNAVAILABLE" }).title, /^Voice is not available right now/);
  assert.deepEqual([v(429, { error: "TRY_RATE_LIMITED", retryAfter: 5 }, 5).wait, v(503, { error: "MODELS_BUSY", retryAfter: 20 }, 20).examples], [5, true]);
  assert.equal(v(0, null).title, "The door did not answer. Try again.");
  assert.equal(VOICE_MAX_BYTES, 1_000_000);

  const calls = [];
  const capture = (reply) => async (url, init) => {
    calls.push({ url, init });
    return reply();
  };
  const clip = new Blob(["x"], { type: "audio/webm;codecs=opus" });
  const voice = await postVoice("http://door/", clip, "v-1", capture(() => new Response(JSON.stringify({ transcript: "hi" }), { status: 200 })));
  assert.deepEqual([voice.status, voice.body.transcript, calls[0].url, calls[0].init.body], [200, "hi", "http://door/v1/try/voice", clip], "the raw clip, not a form");
  assert.deepEqual([calls[0].init.headers["Content-Type"], calls[0].init.headers["X-Visitor-Token"]], ["audio/webm;codecs=opus", "v-1"]);
  await postVoice("http://door", clip, null, capture(() => new Response("{}", { status: 200 })));
  assert.equal("X-Visitor-Token" in calls[1].init.headers, false);

  const xml = await getPeppol("http://door", { orderId: "o 1" }, "v-1", capture(() => new Response("<Order/>", { status: 200 })));
  assert.deepEqual([xml.status, await xml.blob.text(), calls[2].url, calls[2].init.headers["X-Visitor-Token"], "Authorization" in calls[2].init.headers], [200, "<Order/>", "http://door/v1/orders/o%201/peppol", "v-1", false]);
  await getPeppol("http://door", { approvalToken: "tok" }, "v-1", capture(() => new Response("<Order/>", { status: 200 })));
  assert.equal(calls[3].url, "http://door/approve/tok/peppol");
  const held = await getPeppol("http://door", { orderId: "o2" }, "v-1", async () => new Response(JSON.stringify({ error: "ORDER_NOT_ACCEPTED" }), { status: 409 }));
  assert.deepEqual([held.blob, held.error], [null, "ORDER_NOT_ACCEPTED"]);
  assert.equal(PEPPOL_CAPTION, "Peppol BIS Order 3.0 (UBL 2.1). Export only; nothing is sent.");

  const json = (status, body) => async () => new Response(JSON.stringify(body), { status });
  const all = { tryIt: { voice: "https://door/v1/try/voice" }, peppol: { export: "GET /v1/orders/{id}/peppol" }, mcp: { url: "https://door/mcp", oauth: { authorizationServer: "https://door/.well-known/oauth-authorization-server" } } };
  assert.deepEqual(await featuresOn("http://all", json(200, all)), { voice: true, peppol: true, connector: true });
  assert.deepEqual(await featuresOn("http://none", json(200, { tryIt: {}, mcp: { url: "https://door/mcp" } })), { voice: false, peppol: false, connector: false }, "flags off: the door does not advertise them");
  assert.deepEqual(await featuresOn("http://down", json(500, {})), { voice: false, peppol: false, connector: false });
  assert.deepEqual([await voiceOn("http://all"), await peppolOn("http://all"), await connectorOn("http://all")], [true, true, true], "read once per page");
  assert.deepEqual(FEATURE_ROWS.map((r) => r.feature).sort(), ["connector", "peppol", "voice"]);
  assert.deepEqual(WAYS.map((w) => w.feature), ["connector", "voice", "peppol"]);
  assert.ok(FEATURE_ROWS.every((r) => !/[\u2013\u2014]/.test(r.without + r.with)), "no dashes");
});

/** A fake door in the browser: which features its discovery document advertises, and what their routes answer. */
function door(page, { voice = true, peppol = true, peppolStatus = 200, oauth = true } = {}) {
  const state = { voiceReplies: [], voiceReply: { status: 200, body: { transcript: "20 kg of chicken breast fillet by Monday" } }, voicePosts: [], peppolCalls: [] };
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const doc = { tryIt: voice ? { voice: "/v1/try/voice" } : {}, ...(peppol ? { peppol: { export: "GET /v1/orders/{id}/peppol" } } : {}), mcp: { url: "https://lazydoor.lazydoor.workers.dev/mcp", ...(oauth ? { oauth: { authorizationServer: "/.well-known/oauth-authorization-server" } } : {}) } };
  page.route("**/.well-known/agent-gateway.json", (route) => json(route, 200, doc));
  page.route("**/v1/try/voice", (route) => {
    const h = route.request().headers();
    state.voicePosts.push({ type: h["content-type"] ?? "", token: h["x-visitor-token"] });
    const reply = state.voiceReplies.shift() ?? state.voiceReply;
    return json(route, reply.status, reply.body);
  });
  page.route("**/v1/try", (route) => json(route, 200, { visitor: "v-test", buyerId: "visitor-0000feed", step: "decided", draft: { id: "d1" }, order: { orderId: "o-1", state: "ACCEPTED", netCents: 15400, grossCents: 17400, reasons: [] } }));
  page.route("**/v1/orders/*/peppol", (route) => {
    const h = route.request().headers();
    state.peppolCalls.push({ token: h["x-visitor-token"], authorization: h.authorization });
    if (!peppol) return json(route, 404, { error: "NOT_FOUND", detail: "no such route" });
    if (peppolStatus !== 200) return json(route, peppolStatus, { error: "ORDER_NOT_ACCEPTED", detail: "not accepted" });
    return route.fulfill({ status: 200, contentType: "application/xml", headers: { "Content-Disposition": 'attachment; filename="lazydoor-order-o-1.xml"' }, body: "<Order/>" });
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
    await page.waitForSelector('#try-panel .try-mic[aria-pressed="false"]', { state: "attached" });
  };

  await record();
  await page.waitForFunction(() => document.getElementById("try-text").value.length > 0);
  assert.equal(await page.inputValue("#try-text"), "20 kg of chicken breast fillet by Monday");
  assert.equal(await page.locator("#try-panel .try-thread > li").count(), 0, "never sent by itself");
  assert.match(await page.textContent("#try-panel .try-voice-note"), /check it/);
  assert.match(state.voicePosts[0].type, /^audio\//, "the raw clip with its audio type");
  assert.equal(state.voicePosts[0].token, undefined, "no sandbox yet: no token");

  for (const [reply, expected] of [
    [{ status: 400, body: { error: "TRANSCRIPT_EMPTY" } }, /^No words came through/],
    [{ status: 413, body: { error: "PAYLOAD_TOO_LARGE" } }, /^Too long: keep a voice request under 30 s\.$/],
    [{ status: 415, body: { error: "UNSUPPORTED_MEDIA_TYPE" } }, /format the door does not take/],
    [{ status: 503, body: { error: "MODEL_UNAVAILABLE" } }, /^Voice is not available right now/],
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

  state.voiceReply = { status: 404, body: { error: "NOT_FOUND" } };
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

  const stale = await browser.newPage();
  const st = door(stale);
  st.voiceReplies = [{ status: 404, body: { error: "VISITOR_UNKNOWN" } }];
  await stale.addInitScript(() => sessionStorage.setItem("lazydoor.try", JSON.stringify({ visitor: "v-old", buyerId: "visitor-0000dead" })));
  await stale.goto(`${url}?mode=live`);
  const staleMic = stale.locator("#try-panel .try-mic");
  await staleMic.waitFor({ state: "visible" });
  await staleMic.click();
  await stale.waitForSelector('#try-panel .try-mic[aria-pressed="true"]');
  await stale.waitForTimeout(1000);
  await staleMic.click();
  await stale.waitForFunction(() => document.getElementById("try-text").value.length > 0);
  assert.deepEqual(st.voicePosts.map((p) => p.token), ["v-old", undefined], "a forgotten sandbox: sent once more without the token");

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

test("each new strength shows only while the door advertises it: Peppol link, Connect Claude, Inside's ways, Compare's rows, the Deck note", { skip }, async (t) => {
  const { browser, url } = await setup(t, PORT + 2);
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const state = door(page);
  await page.goto(`${url}?mode=live`);
  await page.fill("#try-text", "20 kg of chicken breast fillet by Monday");
  await page.click("#try-panel .try-send");
  const link = page.locator("#try-panel .try-peppol");
  await link.waitFor();
  assert.deepEqual([await link.textContent(), await link.getAttribute("download")], ["Peppol order (UBL XML)", "lazydoor-order-o-1.xml"]);
  assert.match(await link.getAttribute("href"), /^blob:/, "saved through a Blob URL");
  assert.equal((await page.textContent("#try-panel .try-peppol-note")).trim(), "Peppol BIS Order 3.0 (UBL 2.1). Export only; nothing is sent.");
  assert.deepEqual(state.peppolCalls, [{ token: "v-test", authorization: undefined }]);
  await page.waitForSelector("#connect-panel:not([hidden])");
  assert.equal((await page.textContent("#connect-panel h2")).trim(), "Connect Claude");
  assert.equal((await page.textContent("#connect-panel code")).trim(), "https://lazydoor.lazydoor.workers.dev/mcp");
  const steps = await page.$$eval("#connect-panel .connect-steps > li", (lis) => lis.map((li) => li.textContent));
  assert.equal(steps.length, 5);
  assert.match(steps[1], /up to 500\s€ an order and 1,500\s€ a day go through on their own.*Click Allow\.$/);
  assert.match(steps[3], /refused \(403\) on every approval\.$/);
  assert.match(await page.textContent("#connect-panel .connect-note"), /^The kitchen ends after 20 idle minutes/);
  const width = async (p) => p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  let w = await width(page);
  assert.ok(w[0] <= w[1], `Live is ${w[0]} px wide in ${w[1]} px`);

  await page.goto(`${url}?mode=inside`);
  await page.waitForSelector('[data-section="ways"]:not([hidden])');
  const ways = await page.$$eval('[data-section="ways"] .way', (as) => as.map((a) => [a.dataset.feature, a.querySelector("h3").textContent, a.querySelector("img")?.complete ?? null]));
  assert.deepEqual(ways.map((x) => x.slice(0, 2)), [["connector", "From Claude"], ["voice", "By voice"], ["peppol", "Into your ordering system"]]);
  assert.equal(await page.textContent('[data-section="ways"] h2'), "Use it your way");
  w = await width(page);
  assert.ok(w[0] <= w[1], `Inside is ${w[0]} px wide in ${w[1]} px`);
  await page.click('[data-section="ways"] .way[data-feature="voice"] button');
  await page.waitForSelector("#try-panel:not([hidden])");

  await page.goto(`${url}?mode=compare`);
  await page.waitForSelector('#compare-groups .pair-group[data-group="ways"]');
  assert.deepEqual(await page.$$eval('#compare-groups .pair-group[data-group="ways"] h3', (hs) => hs.map((h) => h.textContent)), ["Bring your own AI", "Orders your systems can read", "Speak the order"]);
  await page.goto(`${url}?mode=deck`);
  await page.waitForSelector(".deck-connect", { state: "attached" });
  assert.equal(await page.$$eval(".deck-slide", (lis) => lis.findIndex((li) => li.querySelector(".deck-connect"))), 5, "on the demo slide's notes");

  for (const [opts, why] of [[{ peppolStatus: 409 }, "409 ORDER_NOT_ACCEPTED"], [{ peppol: false }, "not advertised: 404 NOT_FOUND"]]) {
    const other = await browser.newPage();
    door(other, opts);
    await other.goto(`${url}?mode=live`);
    await other.fill("#try-text", "20 kg of chicken breast fillet by Monday");
    await other.click("#try-panel .try-send");
    await other.waitForSelector('#try-panel .try-box[data-kind="accepted"]');
    await other.waitForTimeout(400);
    assert.equal(await other.locator("#try-panel .try-peppol").count(), 0, `${why}: no link`);
  }

  const bare = await browser.newPage();
  door(bare, { voice: false, peppol: false, oauth: false });
  await bare.goto(`${url}?mode=inside`);
  await bare.waitForSelector('[data-section="acceptance"][data-loaded]');
  await bare.waitForTimeout(300);
  assert.equal(await bare.isHidden('[data-section="ways"]'), true, "nothing advertised: no section");
  await bare.goto(`${url}?mode=compare`);
  await bare.waitForTimeout(500);
  assert.equal(await bare.locator('#compare-groups .pair-group[data-group="ways"]').count(), 0);
  await bare.goto(`${url}?mode=live`);
  await bare.waitForSelector("#try-panel .try-chip");
  await bare.waitForTimeout(400);
  assert.deepEqual([await bare.isHidden("#connect-panel"), await bare.isHidden("#try-panel .try-mic")], [true, true]);
});
