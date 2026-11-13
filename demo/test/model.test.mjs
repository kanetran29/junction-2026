import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, reduce, euro, countdown, SHELVES } from "../model.mjs";

const B = "hotel-1";
let seq = 0;
const ev = (type, data = {}, extra = {}) => ({ seq: ++seq, ts: "2026-11-13T21:08:28+02:00", type, buyerId: B, data, ...extra });
const run = (events, state = initialState()) => events.reduce((s, e, i) => reduce(s, e, i), state);

const QUOTE = {
  offers: [{ offerId: "of_1", lines: [{ productId: "464306", salesUnits: 1000 }], netCents: 101000, changes: ["PACK_SIZE_CHANGED"] }],
  rejections: [
    { productId: "463038", code: "CUTOFF_PASSED" },
    { productId: "469363", code: "STOCK_LIMITED", remaining: 384 },
  ],
};

test("reduce: happy path to an approved order on the truck", () => {
  let s = run([ev("draft.created", { text: "1,000 l lactose-free milk by Monday", category: "10400", claims: ["FREE_FROM_LACTOSE"], quantity: { value: 1000, unit: "l" }, unclear: [] }, { draftId: "d1" })]);
  assert.equal(s.agent.at, "chef");
  assert.equal(s.agent.carry, "draft");
  assert.equal(s.draft.quantity.value, 1000);

  s = run([ev("draft.confirmed", {}, { draftId: "d1" })], s);
  assert.equal(s.agent.at, "door");

  s = run([ev("search.done", { count: 35, categories: ["10400"] }), ev("valio.called", { endpoint: "offers", ids: 35, replay: false })], s);
  assert.equal(s.door.scan, true);
  assert.equal(s.replay, false);

  s = run([ev("quote.created", QUOTE, { quoteId: "q1" })], s);
  const shelf = (id) => s.shelves.find((x) => x.productId === id);
  assert.equal(shelf("463038").status, "locked");
  assert.equal(shelf("469363").status, "limited");
  assert.equal(shelf("469363").remaining, 384);
  assert.equal(shelf("464306").status, "ok");
  assert.equal(s.door.scan, false);
  assert.equal(s.quote.offers[0].netCents, 101000);

  s = run([ev("policy.decided", { outcome: "NEEDS_APPROVAL", reasons: [{ code: "OVER_ORDER_AUTO" }, "PACK_SIZE_CHANGED"] })], s);
  assert.equal(s.door.stamp, "NEEDS_APPROVAL");
  assert.deepEqual(s.door.reasons, ["OVER_ORDER_AUTO", "PACK_SIZE_CHANGED"]);

  s = run([ev("approval.requested", { orderId: "o1", expiresAt: "2026-11-15T17:00:00+02:00" }, { orderId: "o1" })], s);
  assert.equal(s.phone.status, "buzzing");
  assert.equal(s.phone.expiresAt, "2026-11-15T17:00:00+02:00");
  assert.equal(s.phone.cents, 101000);

  s = run([ev("approval.approved", {}, { orderId: "o1" }), ev("order.accepted", { lines: [{ productId: "464306", salesUnits: 1000 }], netCents: 101000 }, { orderId: "o1" })], s);
  assert.equal(s.phone.status, "approved");
  assert.equal(s.truck.status, "loading");
  assert.ok(s.truck.crates >= 1);
  assert.equal(s.agent.at, "truck");
  assert.equal(s.agent.carry, "receipt");
});

test("reduce: REJECT sends the agent back with a red card", () => {
  const s = run([ev("draft.created", { text: "1000 cases", quantity: { value: 20000, unit: "l" }, unclear: [] }), ev("policy.decided", { outcome: "REJECT", reasons: [{ code: "OVER_ORDER_HARD" }] })]);
  assert.equal(s.door.stamp, "REJECT");
  assert.equal(s.agent.at, "chef");
  assert.equal(s.agent.carry, "rejected");
});

test("reduce: allergen and subtype rejections cross the shelf; stock.denied sets remaining", () => {
  const s = run([
    ev("quote.created", { offers: [], rejections: [{ productId: "470863", code: "NEW_ALLERGEN" }, { productId: "111111", code: "SUBTYPE_MISMATCH" }] }),
    ev("stock.denied", { productId: "469363", remaining: 51 }),
  ]);
  const shelf = (id) => s.shelves.find((x) => x.productId === id);
  assert.equal(shelf("470863").status, "crossed");
  assert.equal(shelf("111111").status, "crossed");
  assert.equal(shelf("469363").status, "limited");
  assert.equal(shelf("469363").remaining, 51);
});

test("reduce: clock.set, replay flag, expiry", () => {
  let s = run([ev("clock.set", { now: "2026-11-15T17:05:00+02:00" }), ev("valio.called", { replay: true })]);
  assert.equal(s.now, "2026-11-15T17:05:00+02:00");
  assert.equal(s.replay, true);
  s = run([ev("approval.requested", { orderId: "o2", expiresAt: "2026-11-15T17:00:00+02:00" }), ev("approval.expired", {}, { orderId: "o2" })], s);
  assert.equal(s.phone.status, "expired");
});

test("reduce: ignores seq not above last", () => {
  const first = ev("draft.created", { text: "a", unclear: [] });
  let s = run([first, ev("draft.confirmed")]);
  const again = reduce(s, first, 9);
  assert.equal(again, s);
  assert.equal(again.agent.at, "door");
});

test("reduce: tolerates unknown and partial events", () => {
  const s0 = initialState();
  const s1 = reduce(s0, { seq: 1, type: "something.new" }, 0);
  assert.equal(s1.log.at(-1).type, "something.new");
  assert.equal(s1.agent.at, s0.agent.at);
  const s2 = reduce(s1, { seq: 2, type: "quote.created" }, 0);
  assert.deepEqual(s2.shelves.filter((x) => x.productId), []);
  const s3 = reduce(s2, { seq: 3, type: "policy.decided", data: null }, 0);
  assert.equal(s3.door.stamp, null);
  assert.doesNotThrow(() => reduce(s3, null, 0));
});

test("reduce: more products than shelves", () => {
  const rejections = Array.from({ length: SHELVES + 3 }, (_, i) => ({ productId: String(500000 + i), code: "CUTOFF_PASSED" }));
  const s = run([ev("quote.created", { offers: [], rejections })]);
  assert.equal(s.shelves.length, SHELVES);
  assert.equal(s.shelves.at(-1).more, 3);
});

test("reduce: a new draft clears the door and shelves but keeps a pending approval", () => {
  let s = run([ev("quote.created", QUOTE), ev("policy.decided", { outcome: "NEEDS_APPROVAL", reasons: [] }), ev("approval.requested", { orderId: "o1", expiresAt: "x" })]);
  s = run([ev("draft.created", { text: "next", unclear: [] })], s);
  assert.equal(s.door.stamp, null);
  assert.ok(s.shelves.every((x) => x.status === "idle"));
  assert.equal(s.phone.status, "buzzing");
});

test("reduce: unclear draft keeps the agent at the chef with a question", () => {
  const s = run([ev("draft.created", { text: "milk", unclear: ["quantity"] })]);
  assert.equal(s.agent.at, "chef");
  assert.equal(s.agent.carry, "question");
});

test("euro and countdown", () => {
  assert.equal(euro(101000), "1,010.00 €");
  assert.equal(euro(33734), "337.34 €");
  assert.equal(countdown("2026-11-13T21:08:28+02:00", "2026-11-15T17:00:00+02:00"), "43 h 51 min");
  assert.equal(countdown("2026-11-15T16:59:30+02:00", "2026-11-15T17:00:00+02:00"), "0 h 00 min");
  assert.equal(countdown("2026-11-15T17:05:00+02:00", "2026-11-15T17:00:00+02:00"), "closed");
});

test("reduce: story.say sets and clears a speech bubble", () => {
  let s = run([{ type: "story.say", data: { who: "chef", text: "Milk!" } }]);
  assert.deepEqual([s.say.who, s.say.text], ["chef", "Milk!"]);
  s = run([{ type: "story.say", data: {} }], s);
  assert.equal(s.say, null);
});

test("reduce: an outcome outside the schema is ignored", () => {
  const s = run([{ seq: 900, type: "policy.decided", data: { outcome: '"><img src=x onerror=alert(1)>', reasons: [] } }]);
  assert.equal(s.door.stamp, null);
});

test("reduce: shelves remember when their status was set", () => {
  const s = reduce(initialState(), { seq: 1, type: "quote.created", data: QUOTE }, 12.5);
  assert.ok(s.shelves.filter((x) => x.productId).every((x) => x.since === 12.5));
  const d = reduce(s, { seq: 2, type: "stock.denied", data: { productId: "469363", remaining: 3 } }, 20);
  assert.equal(d.shelves.find((x) => x.productId === "469363").since, 20);
});
