import { test } from "node:test";
import assert from "node:assert/strict";
import { STORY, DURATION, VOICE, stateAt, gatewayEvents } from "../story.mjs";

const firstAt = (pred) => STORY.find((item) => pred(item.ev))?.at;
const captions = () => STORY.filter((item) => item.ev.type === "story.caption").map((item) => item.ev.data.text);
/** Every word the Story puts on screen: captions, the chef's typed words, zone cards and lists. */
const words = () => STORY.flatMap(({ ev }) => {
  const d = ev.data;
  if (ev.type === "story.caption" || ev.type === "story.say") return [d.text ?? ""];
  if (ev.type === "story.card") return [d.title ?? "", ...(d.lines ?? []), ...(d.chips ?? [])];
  if (ev.type === "story.list") return [d.title ?? "", ...(d.rows ?? []).map((r) => r.text), d.note ?? ""];
  return [];
}).join("\n");

test("story: at most 1:50 so the pitch video stays under the hard 2:00 limit; sorted; seq strictly increasing", () => {
  assert.ok(DURATION >= 100 && DURATION <= 110, `DURATION ${DURATION}`);
  STORY.forEach((item, i) => i && assert.ok(item.at >= STORY[i - 1].at));
  assert.ok(STORY.at(-1).at <= DURATION);
  const seqs = STORY.map((item) => item.ev.seq);
  seqs.forEach((seq, i) => i && assert.ok(seq > seqs[i - 1]));
});

test("story: nine narration lines, each inside its own scene with a pause before the next", () => {
  assert.equal(VOICE.length, 9);
  VOICE.forEach((v, i) => {
    const end = v.at + v.dur;
    const next = VOICE[i + 1]?.at ?? DURATION + 0.3;
    assert.ok(end + 0.25 <= next, `line ${i + 1} ends at ${end.toFixed(2)}, next starts ${next.toFixed(2)}`);
    assert.match(v.src, /^assets\/voice\/0\d\.mp3$/);
  });
});

test("story: scenes in the script's order: no door, door built, the same request, approval and delivery, cases, close", () => {
  const naive = firstAt((ev) => ev.type === "story.naive");
  const built = firstAt((ev) => ev.type === "story.gate" && ev.data.built === true);
  const draft = firstAt((ev) => ev.type === "draft.created");
  const accepted = firstAt((ev) => ev.type === "order.accepted");
  const auto = firstAt((ev) => ev.type === "policy.decided" && ev.data.outcome === "AUTO");
  const allergen = firstAt((ev) => ev.type === "policy.decided" && ev.data.reasons.some((r) => r.code === "NEW_ALLERGEN"));
  const expired = firstAt((ev) => ev.type === "approval.expired");
  const friday = firstAt((ev) => ev.type === "draft.created" && ev.data.unclear.includes("deliverBy"));
  const close = firstAt((ev) => ev.type === "story.close");
  assert.ok(naive < built && built < draft && draft < accepted && accepted < auto && auto < allergen && allergen < expired && expired < friday && friday < close);
  assert.equal(stateAt(1).gate.built, false);
  assert.equal(stateAt(DURATION).gate.built, true);
});

test("story: the Lazydoor run is held at 1,010.00 € for the kitchen's own limit, approved, accepted with the door's receipt words", () => {
  const accepted = firstAt((ev) => ev.type === "order.accepted");
  const s = stateAt(accepted + 0.01);
  assert.equal(s.phone.status, "approved");
  assert.equal(s.truck.status, "loading");
  assert.equal(s.quote.offers[0].netCents, 101000);
  assert.deepEqual(s.quote.offers[0].changes, ["PACK_SIZE_CHANGED"]);
  assert.deepEqual(s.door.reasons, ["OVER_ORDER_AUTO", "PACK_SIZE_CHANGED"]);
  assert.deepEqual([s.receipt.netCents, s.receipt.grossCents, s.receipt.approvedBy], [101000, 114635, "Kitchen manager"]);
  const quoted = stateAt(firstAt((ev) => ev.type === "quote.created") + 0.01);
  assert.equal(quoted.quote.rejections.length, 28);
  assert.equal(quoted.quote.rejections.filter((r) => r.code === "CUTOFF_PASSED").length, 20);
  assert.equal(quoted.quote.offers.length, 7);
  assert.equal(quoted.shelves.find((x) => x.productId === "463038").status, "locked");
});

test("story: the numbers and words checked on the door (SCRIPT.md sections 12 and 13)", () => {
  const all = words();
  assert.match(all, /1,000 litres of lactose-free milk by Monday, in 10-litre boxes if you can\./);
  for (const fact of ["1,565.50 €", "999999", "Thu 12 Nov 15:00", "35 lactose-free milks", "+18 more", "1,010.00 €", "1,146.35 €", "Stock unknown: Valio does not stock this product", "CO₂e 1,100 kg (product-group average)", "20.20 €", "337.34 €", "190.92 €", "2 left", "666.00 €", "Approver inbox · Kitchen manager", "gluten (AW)", "Gemini: Fri 13 Nov", "Gemma: Fri 20 Nov"]) assert.ok(all.includes(fact), fact);
  assert.ok(!/wheat|unlimited|Only 384 left|2 rejected/i.test(all));
  assert.ok(captions().includes("Over the kitchen's own 500 € limit: a human must approve."));
});

test("story: each case gets its stamp: AUTO, a held split, a 403, NEW_ALLERGEN, the stock race, the expiry, the basket, the question", () => {
  const decided = STORY.filter((item) => item.ev.type === "policy.decided").map((item) => [item.ev.data.outcome, ...item.ev.data.reasons.map((r) => r.code)].join(" "));
  for (const want of ["NEEDS_APPROVAL OVER_DAY_AUTO", "REJECT NEW_ALLERGEN", "NEEDS_APPROVAL OVER_ORDER_AUTO OVER_DAY_AUTO"]) assert.ok(decided.includes(want), want);
  assert.ok(STORY.some((item) => item.ev.type === "story.flash"));
  assert.ok(STORY.some((item) => item.ev.type === "stock.denied" && item.ev.data.remaining === 2));
  const expired = stateAt(firstAt((ev) => ev.type === "approval.expired") + 0.01);
  assert.equal(expired.phone.status, "expired");
  assert.equal(expired.now, "2026-11-15T17:05:00+02:00");
  const asked = stateAt(firstAt((ev) => ev.type === "draft.created" && ev.data.unclear.includes("deliverBy")) + 0.01);
  assert.deepEqual([asked.agent.at, asked.agent.carry], ["chef", "question"]);
  assert.equal(stateAt(DURATION).close, true);
});

test("story: the robot drives home as soon as the door decides, and is parked when the truck delivers", () => {
  const decided = firstAt((ev) => ev.type === "policy.decided");
  assert.equal(stateAt(decided + 0.01).agent.at, "home");
  const accepted = firstAt((ev) => ev.type === "order.accepted");
  assert.equal(stateAt(accepted + 0.01).agent.at, "home");
});

test("story: deterministic", () => {
  assert.deepEqual(stateAt(61.3), stateAt(61.3));
});

test("story: gateway events carry the schema envelope only", () => {
  const events = gatewayEvents();
  assert.ok(events.length > 30);
  for (const ev of events) {
    assert.ok(!ev.type.startsWith("story."));
    assert.equal(typeof ev.seq, "number");
    assert.ok(!Number.isNaN(Date.parse(ev.ts)));
    assert.equal(ev.buyerId, "hotel-aurora");
    assert.equal(typeof ev.data, "object");
  }
});

test("story: every caption stays up long enough to read at 17 characters a second, and at least 2 s", () => {
  const list = STORY.filter((item) => item.ev.type === "story.caption");
  const close = firstAt((ev) => ev.type === "story.close");
  list.forEach((item, i) => {
    const shown = Math.min(list[i + 1]?.at ?? DURATION, close) - item.at;
    const need = Math.max(2, item.ev.data.text.length / 17);
    assert.ok(shown >= need, `${item.ev.data.text} is up ${shown.toFixed(1)} s, needs ${need.toFixed(1)} s`);
  });
});
