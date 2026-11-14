import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { viewOf, postTry, EXAMPLES, dayLabel, CACHED_NOTE } from "../try.mjs";

const SERVER = fileURLToPath(new URL("../dev/fake-gateway.mjs", import.meta.url));
const PORT = 8795;
const ok = (body) => ({ status: 200, body, retryAfter: null });

test("try: each step of the door's reply renders as the panel shows it", () => {
  const q = viewOf(ok({ step: "needs_input", question: { field: "deliverBy", readings: [{ model: "gemini-3.8-flash", value: "2026-11-13" }, { model: "gemma-4-31b-it", value: "2026-11-20" }] } }));
  assert.equal(q.kind, "question");
  assert.equal(q.lines[0], "Gemini read Fri 13 Nov, Gemma read Fri 20 Nov. The door asks, never guesses.");
  assert.deepEqual(q.choices.map((c) => [c.label, c.value]), [["Fri 13 Nov", "2026-11-13"], ["Fri 20 Nov", "2026-11-20"]]);

  const none = viewOf(ok({ step: "no_offer", quote: { rejections: [{ code: "NEW_ALLERGEN" }, { code: "NOT_ORDERABLE" }, { code: "NEW_ALLERGEN" }] } }), { NEW_ALLERGEN: "The substitute adds an allergen." });
  assert.equal(none.title, "No offer: every candidate was refused.");
  assert.deepEqual(none.lines, ["2 × NEW_ALLERGEN: The substitute adds an allergen.", "1 × NOT_ORDERABLE"]);

  const accepted = viewOf(ok({ step: "decided", order: { state: "ACCEPTED", netCents: 15400, reasons: [] } }));
  assert.deepEqual([accepted.tone, accepted.title], ["auto", "Accepted: 154.00 € net. On the pallet for delivery day."]);

  const refused = viewOf(ok({ step: "decided", order: { state: "REJECTED", reasons: [{ code: "OVER_ORDER_HARD", detail: "over 5,000 €" }] } }), { OVER_ORDER_HARD: "The order is above the hard limit." });
  assert.deepEqual([refused.tone, refused.lines], ["reject", ["OVER_ORDER_HARD: The order is above the hard limit."]]);

  const held = viewOf(ok({ step: "decided", order: { state: "HELD", netCents: 101000, grossCents: 114635, reasons: [{ code: "OVER_ORDER_AUTO", detail: "over 500 €" }] }, approval: { token: "t1", expiresAt: "2026-11-15T17:00:00+02:00" } }));
  assert.equal(held.title, "You are the kitchen manager");
  assert.deepEqual(held.lines, ["Net 1,010.00 € · Gross 1,146.35 €", "OVER_ORDER_AUTO: over 500 €", "Decide before Sun 15 Nov 17:00"]);
  assert.deepEqual(held.actions.map((a) => a.decision), ["approve", "reject"]);
  assert.equal(held.token, "t1");

  assert.equal(viewOf(ok({ order: { state: "EXPIRED", reasons: [{ code: "APPROVAL_EXPIRED" }] } }), {}, true).title, "Expired: approved too late, nothing ships.");
  assert.equal(viewOf(ok({ order: { state: "REJECTED", reasons: [] } }), {}, true).title, "Rejected by the kitchen manager. Nothing ships.");
  assert.match(viewOf(ok({ order: { state: "REJECTED", reasons: [{ code: "PRICE_CHANGED" }] } })).lines[0], /^PRICE_CHANGED/);
});

test("try: errors read plainly; 429 counts down, models busy points at the examples, 404 hides the panel", async () => {
  const limited = viewOf({ status: 429, body: { error: "TRY_RATE_LIMITED", retryAfter: 12 }, retryAfter: 12 });
  assert.deepEqual([limited.title, limited.wait], ["Busy: try again in 12 s", 12]);
  assert.equal(viewOf({ status: 429, body: { error: "TRY_RATE_LIMITED" }, retryAfter: null }).wait, 30);
  const full = viewOf({ status: 429, body: { error: "TRY_SANDBOXES_FULL", retryAfter: 60 }, retryAfter: 60 });
  assert.deepEqual([full.title, full.wait], ["Too many visitors right now, try again in a minute.", undefined]);
  const models = viewOf({ status: 503, body: { error: "MODELS_BUSY", retryAfter: 20 }, retryAfter: 20 });
  assert.deepEqual([models.title, models.examples, models.wait], ["The models are busy right now. Try one of the examples, they work instantly.", true, undefined]);
  for (const status of [0, 502, 503]) assert.equal(viewOf({ status, body: null, retryAfter: null }).title, "The door did not answer. Try again.");
  assert.equal(viewOf({ status: 400, body: null, retryAfter: null }).title, "Type a request of 1 to 200 characters.");
  assert.equal(viewOf({ status: 404, body: { error: "TRY_DISABLED" }, retryAfter: null }).kind, "hide");
  assert.equal(viewOf(ok({ draft: { id: "d1", cached: true }, step: "decided", order: { state: "ACCEPTED", netCents: 15400, reasons: [] } })).cached, true);
  assert.equal(viewOf(ok({ draft: { id: "d1" }, step: "decided", order: { state: "ACCEPTED", netCents: 15400, reasons: [] } })).cached, undefined);
  assert.equal(CACHED_NOTE, "Example: readings recorded from Gemini and Gemma");
  const busy = await postTry("http://door", "/v1/try", { text: "x" }, async () => new Response(JSON.stringify({ error: "TRY_RATE_LIMITED" }), { status: 429, headers: { "Retry-After": "7" } }));
  assert.deepEqual([busy.status, busy.retryAfter], [429, 7]);
  assert.equal((await postTry("http://door", "/v1/try", {}, async () => { throw new TypeError("Failed to fetch"); })).status, 0);
  assert.equal(EXAMPLES.length, 4);
  assert.equal(dayLabel("2026-11-16"), "Mon 16 Nov");
});

test("dev server: the try sandbox asks, holds, accepts and logs events under the visitor's own buyer", async (t) => {
  const child = spawn(process.execPath, [SERVER, "--port", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => child.kill());
  await new Promise((resolve) => child.stdout.once("data", resolve));
  const post = (path, body) => fetch(`http://localhost:${PORT}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  assert.equal((await post("/v1/try", { text: "" })).status, 400);
  const held = await post("/v1/try", { text: "1,000 litres of lactose-free milk by Monday" });
  assert.equal(held.body.order.state, "HELD");
  assert.match(held.body.buyerId, /^visitor-[0-9a-f]{8}$/);
  const approved = await post("/v1/try/decision", { visitor: held.body.visitor, token: held.body.approval.token, decision: "approve" });
  assert.equal(approved.body.order.state, "ACCEPTED");
  const ask = await post("/v1/try", { text: "40 kg of chicken breast fillet for Friday, Atria only", visitor: held.body.visitor });
  assert.equal(ask.body.step, "needs_input");
  const answered = await post("/v1/try", { text: "40 kg of chicken breast fillet for Friday, Atria only", visitor: held.body.visitor, draftId: ask.body.draft.id, answer: { field: "deliverBy", value: "2026-11-13" } });
  assert.equal(answered.body.order.state, "ACCEPTED");
  const events = (await (await fetch(`http://localhost:${PORT}/v1/events?since=0`)).json()).events;
  assert.ok(events.length > 10 && events.every((e) => e.buyerId === held.body.buyerId));
});
