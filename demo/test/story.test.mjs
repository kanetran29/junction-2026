import { test } from "node:test";
import assert from "node:assert/strict";
import { STORY, DURATION, VOICE, stateAt, gatewayEvents } from "../story.mjs";
import { dayTotal } from "../model.mjs";
import fixture from "../fixtures/story-v2.json" with { type: "json" };

const firstAt = (pred) => STORY.find((item) => pred(item.ev))?.at;
/** Second at which scene 2 (the door goes up) starts. */
const START_OF_2 = STORY.find((item) => item.ev.type === "story.gate" && item.ev.data.built === true).at - 0.3;
const decided = (outcome, ...codes) => (ev) => ev.type === "policy.decided" && ev.data.outcome === outcome && codes.every((c) => ev.data.reasons.includes(c));
/** Every word the Story puts on screen: captions, the chef's typed words, zone cards, lists and the receipt. */
const words = () => STORY.flatMap(({ ev }) => {
  const d = ev.data;
  if (ev.type === "story.caption" || ev.type === "story.say") return [d.text ?? ""];
  if (ev.type === "story.card") return [d.title ?? "", ...(d.lines ?? []), ...(d.chips ?? [])];
  if (ev.type === "story.list") return [d.title ?? "", ...(d.rows ?? []).map((r) => r.text), d.note ?? ""];
  if (ev.type === "story.receipt") return [d.title, ...d.lines];
  return [];
}).join("\n");

test("story: at most 1:50 so the pitch video stays under the hard 2:00 limit; sorted; seq strictly increasing", () => {
  assert.ok(DURATION >= 100 && DURATION <= 110, `DURATION ${DURATION}`);
  STORY.forEach((item, i) => i && assert.ok(item.at >= STORY[i - 1].at));
  assert.ok(STORY.at(-1).at <= DURATION);
  STORY.forEach((item, i) => i && assert.ok(item.ev.seq > STORY[i - 1].ev.seq));
});

test("story: eleven narration lines (SCRIPT.md 14.4), each inside its own scene with a pause before the next", () => {
  assert.equal(VOICE.length, 11);
  VOICE.forEach((v, i) => {
    const end = v.at + v.dur;
    const next = VOICE[i + 1]?.at ?? DURATION + 0.3;
    assert.ok(end + 0.25 <= next, `line ${i + 1} ends at ${end.toFixed(2)}, next starts ${next.toFixed(2)}`);
    assert.match(v.src, /^assets\/voice\/\d\d\.mp3$/);
  });
});

test("story: every event of the real door run is on the timeline once, in the door's order", () => {
  const placed = gatewayEvents();
  assert.equal(placed.length, fixture.events.length);
  placed.forEach((ev, i) => assert.deepEqual([ev.type, ev.buyerId, ev.data], [fixture.events[i].type, fixture.events[i].buyerId, fixture.events[i].data]));
});

test("story: one connected story in the order of SCRIPT.md 14.1", () => {
  const order = [
    firstAt((ev) => ev.type === "story.naive"),
    firstAt((ev) => ev.type === "story.gate" && ev.data.built === true),
    firstAt((ev) => ev.type === "draft.created"),
    firstAt(decided("NEEDS_APPROVAL", "OVER_ORDER_AUTO", "PACK_SIZE_CHANGED")),
    firstAt(decided("AUTO")),
    firstAt((ev) => ev.type === "draft.created" && ev.data.crossCheck?.result === "disagreed"),
    firstAt((ev) => ev.type === "approval.approved"),
    firstAt((ev) => ev.type === "quote.created" && ev.data.rejections.some((r) => r.code === "NEW_ALLERGEN")),
    firstAt(decided("NEEDS_APPROVAL", "OVER_DAY_AUTO")),
    firstAt((ev) => ev.type === "approval.expired"),
    firstAt((ev) => ev.type === "story.ship"),
    firstAt((ev) => ev.type === "story.close"),
  ];
  order.forEach((at, i) => assert.ok(Number.isFinite(at) && (i === 0 || at > order[i - 1]), `step ${i} at ${at}`));
  assert.equal(stateAt(1).gate.built, false);
  assert.equal(stateAt(DURATION).gate.built, true);
});

test("story: the milk is held for the kitchen's 500 € order limit only, the agent's own approval changes nothing, the manager approves it on Saturday", () => {
  const held = stateAt(firstAt(decided("NEEDS_APPROVAL", "OVER_ORDER_AUTO")) + 0.01);
  assert.deepEqual(held.door.reasons, ["OVER_ORDER_AUTO", "PACK_SIZE_CHANGED"]);
  assert.equal(held.quote.offers[0].netCents, 101000);
  assert.equal(held.quote.rejections.length, 28);
  assert.equal(held.quote.rejections.filter((r) => r.code === "CUTOFF_PASSED").length, 20);
  const own = stateAt(firstAt((ev) => ev.type === "story.flash") + 0.01);
  assert.equal(own.agent.carry, "approve");
  assert.equal(own.phone.status, "buzzing", "the 403 leaves the order waiting for the manager");
  const accepted = stateAt(firstAt((ev) => ev.type === "order.accepted" && ev.data.netCents === 101000) + 0.01);
  assert.equal(accepted.phone.status, "approved");
  assert.equal(accepted.now, "2026-11-14T10:15:00+02:00");
  assert.equal(accepted.truck.status, "parked", "accepted orders wait on the pallet for Monday");
  assert.equal(accepted.pallet.crates, 4);
});

test("story: the day total follows the kitchen's rule: 1,010.00 held + 190.92 auto, basket over 1,500 €, back after the expiry", () => {
  const sum = (t) => dayTotal(stateAt(t));
  assert.deepEqual(sum(firstAt(decided("AUTO")) + 0.01), { accepted: 19092, pending: 101000 });
  assert.deepEqual(sum(firstAt((ev) => ev.type === "approval.approved") + 0.01), { accepted: 120092, pending: 0 });
  const basket = sum(firstAt(decided("NEEDS_APPROVAL", "OVER_DAY_AUTO")) + 0.01);
  assert.deepEqual(basket, { accepted: 120092, pending: 66600 });
  assert.ok(basket.accepted + basket.pending > 150000);
  assert.deepEqual(sum(firstAt((ev) => ev.type === "approval.expired") + 0.01), { accepted: 120092, pending: 0 });
  const split = STORY.find((item) => item.ev.type === "story.split" && item.ev.data.step === "touch");
  assert.equal(120092 + split.ev.data.cents[0], 150392, "the first split part alone tips the day over 1,500 €");
});

test("story: the other hotel's events never move our robot; it is refused STOCK_TAKEN and learns 2 are left", () => {
  const ours = stateAt(firstAt(decided("AUTO")) + 0.01);
  const theirs = stateAt(firstAt((ev) => ev.type === "stock.denied") + 0.01);
  assert.equal(theirs.door.stamp, "AUTO");
  assert.equal(theirs.agent.at, ours.agent.at);
  assert.ok(theirs.flash.since > ours.door.since);
  assert.equal(theirs.shelves.find((x) => x.productId === "470746").remaining, 2);
  assert.ok(STORY.some((item) => item.ev.buyerId === "hotel-b" && item.ev.type === "policy.decided" && item.ev.data.reasons.includes("STOCK_TAKEN")));
});

test("story: Lazydoor's letter goes to the manager's phone at every approval request; the approval comes back from the phone", () => {
  for (const item of STORY.filter((x) => x.ev.type === "approval.requested")) {
    assert.ok(STORY.some((x) => x.at === item.at && x.ev.type === "story.mail" && x.ev.data.kind === "lazydoor" && x.ev.data.to === "phone"));
  }
  const back = STORY.find((x) => x.ev.type === "story.mail" && x.ev.data.kind === "approved");
  assert.equal(back.ev.data.from, "phone");
  assert.equal(back.at, firstAt((ev) => ev.type === "approval.approved"));
});

test("story: the numbers and words checked on the door (SCRIPT.md 12, 13, 14.3)", () => {
  const all = words();
  assert.match(all, /1,000 litres of lactose-free milk by Monday, in 10-litre boxes if you can\./);
  for (const fact of ["1,565.50 €", "999999", "Thu 12 Nov 15:00", "+18 more", "1,010.00 €", "1,146.35 €", "Stock unknown: Valio does not stock this product", "CO₂e 1,100 kg (product-group average)", "AGENT_CANNOT_APPROVE", "190.92 €", "2 left", "666.00 €", "755.91 €", "gluten (AW)", "Gemini: Fri 13 Nov", "Gemma: Fri 20 Nov", "Net 1,010.00 · Gross 1,146.35 EUR", "Approved by Kitchen manager", "Accepted (simulated)"]) assert.ok(all.includes(fact), fact);
  assert.ok(!/wheat|unlimited|Only 384 left|2 rejected/i.test(all));
  assert.ok(all.includes("Lazydoor sends the request to the kitchen manager. Not Valio. Not the agent."));
});

test("story: the robot drives home as soon as the door decides; Monday's truck takes the pallet", () => {
  for (const item of STORY.filter((x) => x.ev.type === "policy.decided" && x.ev.buyerId !== "hotel-b")) assert.equal(stateAt(item.at + 0.01).agent.at, "home");
  const ship = stateAt(firstAt((ev) => ev.type === "story.ship") + 0.01);
  assert.deepEqual([ship.truck.status, ship.truck.crates, ship.pallet.crates], ["loading", 4, 0]);
  assert.equal(ship.now, "2026-11-16T08:00:00+02:00");
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
    assert.ok(["admin", "hotel-a", "hotel-b"].includes(ev.buyerId), ev.buyerId);
    assert.equal(typeof ev.data, "object");
  }
});

test("story: every caption stays up at least 3 s and long enough to read at 17 characters a second (SCRIPT.md 14.3)", () => {
  const list = STORY.filter((item) => item.ev.type === "story.caption");
  const close = firstAt((ev) => ev.type === "story.close");
  list.forEach((item, i) => {
    const shown = Math.min(list[i + 1]?.at ?? DURATION, close) - item.at;
    const need = Math.max(3, item.ev.data.text.length / 17);
    assert.ok(shown >= need - 1e-9, `${item.ev.data.text} is up ${shown.toFixed(2)} s, needs ${need.toFixed(2)} s`);
  });
});

test("story: Kane's fixes (SCRIPT.md 16): no milk on Monday, one door for every kitchen, accepted orders ship Monday", () => {
  const all = words();
  assert.ok(all.includes("Closed Thu 15:00. Monday: no milk."));
  assert.equal(stateAt(14).nomilk, true);
  assert.equal(stateAt(START_OF_2 + 0.01).nomilk, false);
  assert.ok(all.includes("One door at Valio. Each kitchen brings its own signed rules."));
  assert.ok(stateAt(START_OF_2 + 3).mandates, "the kitchens' signed cards go into the door's rack in scene 2");
  assert.ok(all.includes("Accepted Fri · ships Mon 16 Nov") && all.includes("Accepted Sat · ships Mon 16 Nov"));
  assert.ok(all.includes("Another hotel: same door, its own rules."));
});
