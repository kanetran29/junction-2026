import { test } from "node:test";
import assert from "node:assert/strict";
import { STORY, DURATION, stateAt, gatewayEvents } from "../story.mjs";

const firstAt = (pred) => STORY.find((item) => pred(item.ev))?.at;

test("story: sorted, at most 1:50 so a two-minute pitch video keeps 10 s for a title, seq strictly increasing", () => {
  assert.ok(DURATION >= 100 && DURATION <= 110);
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

test("story: Act 1 has no door, the door is built after the naive run, the same agent walks in Act 2", () => {
  const gone = firstAt((ev) => ev.type === "story.naive" && ev.data.step === "gone");
  const built = firstAt((ev) => ev.type === "story.gate" && ev.data.built === true);
  const draft = firstAt((ev) => ev.type === "draft.created");
  assert.equal(stateAt(1).gate.built, false);
  assert.equal(stateAt(20).gate.built, false);
  assert.ok(gone < built && built < draft);
  assert.equal(stateAt(built + 0.01).gate.built, true);
  assert.equal(stateAt(DURATION).gate.built, true);
  const caption = STORY.find((item) => item.at >= built - 1 && item.ev.type === "story.caption");
  assert.match(caption.ev.data.text, /built a door/);
});

test("story: every caption stays up long enough to read at 17 characters a second, and at least 2 s", () => {
  const captions = STORY.filter((item) => item.ev.type === "story.caption");
  captions.forEach((item, i) => {
    const shown = (captions[i + 1]?.at ?? DURATION) - item.at;
    const need = Math.max(2, item.ev.data.text.length / 17);
    assert.ok(shown >= need, `${item.ev.data.text} is up ${shown.toFixed(1)} s, needs ${need.toFixed(1)} s`);
  });
});

test("story: the approval limit is the kitchen's own rule, and the door carries the kitchen's signed rules", () => {
  const texts = STORY.filter((item) => item.ev.type === "story.caption").map((item) => item.ev.data.text);
  assert.ok(texts.includes("Over the kitchen's own 500 € limit, and boxes became cartons: NEEDS_APPROVAL."));
  const built = firstAt((ev) => ev.type === "story.gate" && ev.data.built === true);
  const draft = firstAt((ev) => ev.type === "draft.created");
  assert.ok(STORY.some((item) => item.at >= built && item.at <= draft && item.ev.type === "story.caption" && /kitchen's own signed rules/.test(item.ev.data.text)));
  assert.ok(!texts.some((text) => /unlimited/i.test(text)));
});
