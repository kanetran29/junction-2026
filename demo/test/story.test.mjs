import { test } from "node:test";
import assert from "node:assert/strict";
import { STORY, DURATION, stateAt, gatewayEvents } from "../story.mjs";

const firstAt = (pred) => STORY.find((item) => pred(item.ev))?.at;

test("story: sorted, about two minutes, seq strictly increasing", () => {
  assert.ok(DURATION >= 115 && DURATION <= 125);
  STORY.forEach((item, i) => i && assert.ok(item.at >= STORY[i - 1].at));
  assert.ok(STORY.at(-1).at <= DURATION);
  const seqs = STORY.map((item) => item.ev.seq);
  seqs.forEach((seq, i) => i && assert.ok(seq > seqs[i - 1]));
});

test("story: beats in order", () => {
  const naive = firstAt((ev) => ev.type === "story.naive");
  const draft = firstAt((ev) => ev.type === "draft.created");
  const accepted = firstAt((ev) => ev.type === "order.accepted");
  const reject = firstAt((ev) => ev.type === "policy.decided" && ev.data.outcome === "REJECT");
  const close = firstAt((ev) => ev.type === "story.close");
  assert.ok(naive < draft && draft < accepted && accepted < reject && reject < close);
});

test("story: the Lazydoor run ends approved and loaded at 1,010.00 €", () => {
  const accepted = firstAt((ev) => ev.type === "order.accepted");
  const s = stateAt(accepted + 0.01);
  assert.equal(s.phone.status, "approved");
  assert.equal(s.truck.status, "loading");
  assert.equal(s.quote.offers[0].netCents, 101000);
  assert.deepEqual(s.door.reasons, ["OVER_ORDER_AUTO", "PACK_SIZE_CHANGED"]);
  const quoted = stateAt(firstAt((ev) => ev.type === "quote.created") + 0.01);
  assert.equal(quoted.shelves.find((x) => x.productId === "463038").status, "locked");
  assert.equal(quoted.shelves.find((x) => x.productId === "469363").remaining, 384);
});

test("story: attacks bounce", () => {
  const codes = STORY.filter((item) => item.ev.type === "policy.decided").flatMap((item) => item.ev.data.reasons.map((r) => r.code));
  for (const code of ["OVER_DAY_AUTO", "OVER_ORDER_HARD", "NEW_ALLERGEN"]) assert.ok(codes.includes(code), code);
  const allergen = stateAt(firstAt((ev) => ev.type === "quote.created" && ev.data.rejections.some((r) => r.code === "NEW_ALLERGEN")) + 0.01);
  assert.equal(allergen.shelves.find((x) => x.productId === "470863").status, "crossed");
  const end = stateAt(DURATION);
  assert.equal(end.phone.status, "expired");
  assert.equal(end.now, "2026-11-15T17:05:00+02:00");
  assert.equal(end.close, true);
});

test("story: deterministic", () => {
  assert.deepEqual(stateAt(61.3), stateAt(61.3));
});

test("story: gateway events carry the schema envelope only", () => {
  const events = gatewayEvents();
  assert.ok(events.length > 20);
  for (const ev of events) {
    assert.ok(!ev.type.startsWith("story."));
    assert.equal(typeof ev.seq, "number");
    assert.ok(!Number.isNaN(Date.parse(ev.ts)));
    assert.equal(ev.buyerId, "hotel-aurora");
    assert.equal(typeof ev.data, "object");
  }
});
