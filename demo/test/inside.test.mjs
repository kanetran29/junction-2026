import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WHAT, FLOW, GUARDRAILS, BUILT_WITH, CHECKS, COMMANDS, summarize, runCheck } from "../inside.mjs";

const SERVER = fileURLToPath(new URL("../dev/fake-gateway.mjs", import.meta.url));
const PORT = 8796;
/** playwright-core from PLAYWRIGHT_CORE (or the default resolution); the browser test is skipped when it is not installed. */
const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core").catch(() => null);

test("inside: every section has content; the flow has seven steps; eleven guardrails, each with a code and its proof", () => {
  assert.ok(WHAT.punchline && WHAT.lines.length === 2);
  assert.equal(FLOW.length, 7);
  assert.equal(GUARDRAILS.length, 11);
  for (const g of GUARDRAILS) assert.ok(g.what && g.code && g.proof, g.what);
  assert.equal(BUILT_WITH.length, 6);
  assert.deepEqual(CHECKS.map((c) => c.path), ["/v1/audit/verify", "/.well-known/jwks.json", "/.well-known/agent-gateway.json", "/v1/rules", "/v1/reason-codes"]);
  assert.match(COMMANDS[0], /^node scripts\/verify-audit\.mjs https:\/\//);
});

test("inside: proof.json loads with the numbers, the agent-run video and the pitch-video placeholder", () => {
  const proof = JSON.parse(readFileSync(new URL("../proof.json", import.meta.url), "utf8"));
  for (const key of ["acceptance", "scenarios", "tests"]) assert.equal(typeof proof[key].passed, "number", key);
  assert.equal(proof.agentRun.src, "assets/proof/agent-run.mp4");
  assert.ok(readFileSync(new URL(`../${proof.agentRun.src}`, import.meta.url)).length > 1e6);
  assert.ok("url" in proof.pitchVideo);
});

test("inside: each live check degrades gracefully: 404 or 401 is 'coming with the next deploy', no answer is 'not reachable'", async () => {
  for (const check of CHECKS) {
    assert.deepEqual(await runCheck("http://door", check, async () => new Response("no", { status: 404 })), { state: "pending", text: "Coming with the next deploy." });
    assert.equal((await runCheck("http://door", check, async () => new Response("key", { status: 401 }))).state, "pending");
    assert.equal((await runCheck("http://door", check, async () => { throw new TypeError("Failed to fetch"); })).state, "down");
  }
});

test("inside: live results read like the door's own replies", () => {
  assert.equal(summarize("audit", 200, { valid: true, count: 1189, headHash: "0123456789abcdef" }).text, "Chain valid ✓ · 1189 events · head 0123456789ab");
  assert.equal(summarize("audit", 200, { valid: false, count: 9, firstBadSeq: 4, headHash: "x" }).state, "bad");
  assert.equal(summarize("rules", 200, { decisions: [{ owner: "seller" }, { owner: "seller" }, { owner: "buyer" }] }).text, "3 rules · 2 seller, 1 buyer");
  assert.equal(summarize("codes", 200, { codes: [{}, {}] }).text, "2 reason codes, each with its text and resolution");
  assert.match(summarize("jwks", 200, { keys: [{ kid: "abc", alg: "EdDSA", crv: "Ed25519" }] }).text, /^Key id abc/);
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
  await page.waitForFunction(() => document.querySelector(".proof-body[data-loaded]") && ![...document.querySelectorAll(".live-checks li")].some((li) => li.dataset.state === "loading"));
  const out = await page.evaluate(() => ({
    sections: [...document.querySelectorAll("#inside-page .inside-section h2")].map((h) => h.textContent),
    states: [...document.querySelectorAll(".live-checks li")].map((li) => li.dataset.state),
    numbers: document.querySelectorAll(".proof-numbers li").length,
    video: document.querySelector("video.agent-run")?.getAttribute("src"),
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  assert.deepEqual(out.sections, ["What it is", "How an order flows", "Guardrails, with evidence", "Check it yourself, live", "Proof", "Built with", "Path to production"]);
  assert.deepEqual(out.states, ["pending", "pending", "pending", "pending", "pending"], "the dev server has none of the door's routes: each says it is coming");
  assert.equal(out.numbers, 3);
  assert.equal(out.video, "assets/proof/agent-run.mp4");
  assert.ok(out.scroll <= out.client, `page is ${out.scroll} px wide in a ${out.client} px viewport`);
});
