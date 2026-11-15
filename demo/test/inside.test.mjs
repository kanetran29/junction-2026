import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { HERO, FLOW, GUARDRAILS, BUILT_WITH, CHECKS, COMMANDS, summarize, runCheck } from "../inside.mjs";
import { scoreOf, readingText, modelsReady } from "../models-view.mjs";

const SERVER = fileURLToPath(new URL("../dev/fake-gateway.mjs", import.meta.url));
const PORT = 8796;
/** playwright-core from PLAYWRIGHT_CORE (or the default resolution); the browser test is skipped when it is not installed. */
const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core").catch(() => null);

test("inside: hero sentence of at most 20 words; seven verbs on the track; eleven guardrails in three clusters, codes and proof as separate chips", () => {
  assert.ok(HERO.punchline && HERO.sentence.split(/\s+/).length <= 20);
  assert.equal(FLOW.length, 7);
  for (const f of FLOW) assert.ok(/^[A-Z][a-z]+$/.test(f.verb) && f.detail, f.verb);
  assert.deepEqual(GUARDRAILS.map((c) => c.heading), ["Valio's data, read right", "The kitchen's limits", "Safety and honesty"]);
  const items = GUARDRAILS.flatMap((c) => c.items);
  assert.equal(items.length, 11);
  for (const g of items) assert.ok(g.text && g.codes.length && g.proof.length && !g.codes.concat(g.proof).some((v) => v.includes("·")), g.text);
  assert.deepEqual(BUILT_WITH.map((g) => g.group), ["Data", "Models", "Runtime and interfaces"]);
  assert.deepEqual(CHECKS.map((c) => c.path), ["/v1/audit/verify", "/.well-known/jwks.json", "/.well-known/agent-gateway.json", "/v1/rules", "/v1/reason-codes"]);
  assert.match(COMMANDS[0], /^node scripts\/verify-audit\.mjs https:\/\//);
});

test("inside: proof.json loads with the numbers, the agent-run video and the pitch-video placeholder", () => {
  const proof = JSON.parse(readFileSync(new URL("../proof.json", import.meta.url), "utf8"));
  for (const key of ["acceptance", "scenarios", "tests"]) assert.equal(typeof proof[key].passed, "number", key);
  assert.equal(proof.agentRun.src, "assets/proof/agent-run.mp4");
  assert.ok(readFileSync(new URL(`../${proof.agentRun.poster}`, import.meta.url)).length > 10000, "the video has a poster frame");
  assert.ok(readFileSync(new URL(`../${proof.agentRun.src}`, import.meta.url)).length > 1e6);
  assert.ok("url" in proof.pitchVideo);
});

test("inside: each live check degrades gracefully: 404 or 401 is 'coming with the next deploy', no answer is 'not reachable'", async () => {
  for (const check of CHECKS) {
    assert.deepEqual(await runCheck("http://door", check, async () => new Response("no", { status: 404 })), { state: "pending", value: "Next deploy", text: "Coming with the next deploy." });
    assert.equal((await runCheck("http://door", check, async () => new Response("key", { status: 401 }))).state, "pending");
    assert.equal((await runCheck("http://door", check, async () => { throw new TypeError("Failed to fetch"); })).state, "down");
  }
});

test("inside: live results read like the door's own replies", () => {
  assert.deepEqual(summarize("audit", 200, { valid: true, count: 1189, headHash: "0123456789abcdef" }), { state: "ok", value: "Chain valid", text: "1189 events, head 0123456789ab" });
  assert.equal(summarize("audit", 200, { valid: false, count: 9, firstBadSeq: 4, headHash: "x" }).state, "bad");
  assert.deepEqual(summarize("rules", 200, { decisions: [{ owner: "seller" }, { owner: "seller" }, { owner: "buyer" }] }), { state: "ok", value: "3 rules", text: "2 seller, 1 buyer" });
  assert.equal(summarize("codes", 200, { codes: [{}, {}] }).value, "2 codes");
  assert.deepEqual(summarize("jwks", 200, { keys: [{ kid: "abcdefghijklmnop", alg: "EdDSA", crv: "Ed25519" }] }), { state: "ok", value: "EdDSA Ed25519", text: "Key id abcdefghijkl" });
  assert.equal(summarize("discovery", 200, { openapi: "a", mcp: { url: "b" }, jwks: "c" }).list.length, 3);
});

test("inside page: renders every section, loads proof.json, shows each live check gracefully, no horizontal scroll at 375 px", { skip: !pw && "playwright-core not installed (set PLAYWRIGHT_CORE)" }, async (t) => {
  const child = spawn(process.execPath, [SERVER, "--port", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => child.kill());
  await new Promise((resolve) => child.stdout.once("data", resolve));
  const chromium = pw.chromium ?? pw.default.chromium;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.goto(`http://localhost:${PORT}/?mode=inside`);
  await page.waitForFunction(() => document.querySelector('.inside-section[data-section="proof"][data-loaded]') && ![...document.querySelectorAll(".tile")].some((t) => t.dataset.state === "loading"));
  await page.waitForFunction(() => [...document.querySelectorAll(".stack-group .mark-img")].every((img) => img.complete), null, { timeout: 5000 }).catch(() => {});
  const out = await page.evaluate(() => ({
    sections: [...document.querySelectorAll("#inside-page .inside-section")].map((s) => s.dataset.section),
    h1: document.querySelector("#inside-page h1")?.textContent,
    h1Lines: (() => { const h = document.querySelector("#inside-page h1"); return Math.round(h.getBoundingClientRect().height / (parseFloat(getComputedStyle(h).fontSize) * 1.05)); })(),
    stills: [...document.querySelectorAll("#inside-page .still img")].map((i) => i.getAttribute("src")),
    track: document.querySelectorAll(".track li").length,
    clusters: document.querySelectorAll(".cluster").length,
    tiles: [...document.querySelectorAll(".tile")].map((t) => `${t.dataset.check}:${t.dataset.state}`),
    numerals: document.querySelectorAll(".numeral").length,
    poster: document.querySelector("video.agent-run")?.getAttribute("poster"),
    pitch: document.querySelectorAll(".pitch-link").length,
    marks: [...document.querySelectorAll(".stack-group li")].map((li) => [...li.querySelectorAll(".marks > *")].map((m) => m.getAttribute("src") ?? m.style.getPropertyValue("--logo").match(/logos\/(.+)\.svg/)?.[1])),
    marksLoaded: [...document.querySelectorAll(".stack-group .mark-img")].every((img) => img.complete && img.naturalWidth > 0),
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    modelsHidden: document.querySelector('.inside-section[data-section="models"]').hidden,
    optional: [...document.querySelectorAll(".check-links a")].map((a) => a.textContent),
    cors: document.querySelectorAll(".check-cors").length,
  }));
  assert.equal(out.modelsHidden, !existsSync(new URL("../models.json", import.meta.url)), "the models section shows exactly when models.json is there");
  assert.deepEqual([out.optional, out.cors], [["OpenAPI document", "Discovery document"], 0], "api-catalog, llms.txt and CORS show only once the door answers them");
  assert.deepEqual(out.sections, ["hero", "flow", "models", "guardrails", "ways", "checks", "proof", "acceptance", "stack", "production"]);
  assert.equal(out.h1, "Lazy at the order, strict at the border.");
  assert.ok(out.h1Lines <= 2, `the punchline takes ${out.h1Lines} lines at 375 px`);
  assert.equal(out.stills.length, 4);
  assert.deepEqual([out.track, out.clusters, out.numerals], [7, 3, 3]);
  assert.deepEqual(out.tiles, ["audit:pending", "jwks:pending", "rules:pending", "discovery:pending"], "the dev server has none of the door's routes: each tile says it is coming");
  assert.equal(out.poster, "assets/proof/agent-run-poster.webp");
  assert.equal(out.pitch, 1, "the pitch video's link");
  assert.deepEqual(out.marks, [["assets/logos/aiven-logo-white.svg"], ["cloudflare"], ["googlegemini"], ["assets/logos/gemma-mark-dark.svg"], ["cloudflare"], ["openapiinitiative", "modelcontextprotocol"]]);
  assert.ok(out.marksLoaded, "the official logos load");
  assert.ok(out.scroll <= out.client, `page is ${out.scroll} px wide in a ${out.client} px viewport`);
});

test("models: scores and readings read the eval's shape; the second reader has no asked or unflagged count", () => {
  const data = JSON.parse(readFileSync(new URL("./models.fixture.json", import.meta.url), "utf8"));
  assert.ok(modelsReady(data));
  assert.equal(modelsReady({ models: [], rows: [] }), false);
  assert.deepEqual(scoreOf(data.models[0], 3), { exact: "2/3", fields: "17/18 fields", asked: "1", unflagged: "0", risky: false, ms: "1,240 ms", role: "Door's reader" });
  assert.deepEqual([scoreOf(data.models[1], 3).asked, scoreOf(data.models[1], 3).role], ["n/a", "Second reader"]);
  assert.equal(scoreOf(data.models[2], 3).risky, true);
  assert.deepEqual(data.rows.map((r) => readingText(r.readings["fixture-small"])), ["✓", "deliveryDate, unit", "error"]);
});

test("models page: the section, the grid and the Proof line show from models.json, no horizontal page scroll at 375 px", { skip: !pw && "playwright-core not installed (set PLAYWRIGHT_CORE)" }, async (t) => {
  const child = spawn(process.execPath, [SERVER, "--port", String(PORT + 1)], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => child.kill());
  await new Promise((resolve) => child.stdout.once("data", resolve));
  const chromium = pw.chromium ?? pw.default.chromium;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
  t.after(() => browser.close());
  const fixture = readFileSync(new URL("./models.fixture.json", import.meta.url), "utf8");
  for (const width of [375, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route("**/models.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: fixture }));
    await page.goto(`http://localhost:${PORT + 1}/?mode=inside`);
    await page.waitForSelector('.inside-section[data-section="models"][data-loaded]');
    await page.waitForSelector(".proof-models");
    const out = await page.evaluate(() => ({
      h2: document.querySelector(".is-models h2").textContent,
      rows: [...document.querySelectorAll(".models-score tbody tr")].map((tr) => [...tr.children].map((c) => c.textContent)),
      door: document.querySelector(".models-score tr[data-door]")?.dataset.model,
      grid: [...document.querySelectorAll(".models-grid tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((c) => c.textContent)),
      proof: document.querySelector(".proof-models").textContent,
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    assert.equal(out.h2, "Same sentence, several models");
    assert.deepEqual(out.rows[1], ["Gemma 4 31BSecond reader", "2/316/18 fields", "n/a", "n/a", "2,310 ms"]);
    assert.equal(out.door, "gemini-3.8-flash");
    assert.deepEqual(out.grid, [["✓", "✓", "✓"], ["✓", "deliveryDate", "deliveryDate, unit"], ["qty", "✓", "error"]]);
    assert.equal(out.proof, "3 models read the same 3 sentences: the door's reader read 2 exactly, asked the kitchen on 1 and let 0 wrong readings through.");
    assert.ok(out.scroll <= out.client, `page is ${out.scroll} px wide in a ${out.client} px viewport`);
    if (width === 375) await page.locator(".is-models").screenshot({ path: fileURLToPath(new URL("../shots/models-375.png", import.meta.url)) });
    else await page.locator(".is-models").screenshot({ path: fileURLToPath(new URL("../shots/models-desktop.png", import.meta.url)) });
    await page.close();
  }
});
