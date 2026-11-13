// The scripted two-minute story: gateway events (same schema as live) plus story.* cues, at fixed seconds.
import { initialState, reduce, CUTOFF } from "./model.mjs";

export const DURATION = 120;
const BUYER = "hotel-aurora";
const START = "2026-11-14T10:15:00+02:00";
const AFTER_CUTOFF = "2026-11-15T17:05:00+02:00";
const MILK = "464306";

const line = (salesUnits) => [{ productId: MILK, salesUnits }];
const offer = (salesUnits, changes = []) => ({ offerId: `of_${salesUnits}`, lines: line(salesUnits), netCents: salesUnits * 101, changes });
const why = (...codes) => codes.map((code) => ({ code }));

/** Beat list as [seconds, type, data, ids]; ids name the draft/quote/order the event belongs to. */
const BEATS = [
  // 1. The chef asks.
  [0, "clock.set", { now: START }],
  [0.2, "story.caption", { text: "Saturday 10:15. The hotel kitchen needs milk for Monday." }],
  [1.6, "story.say", { who: "chef", text: "1,000 litres of lactose-free milk by Monday. Bulk boxes if you can." }],
  [9.5, "story.say", {}],

  // 2. A naive agent skips the door.
  [10, "story.caption", { text: "A naive agent skips the door and trusts the raw supplier API." }],
  [10.4, "story.naive", { step: "enter" }],
  [15, "story.naive", { step: "grab" }],
  [15.2, "story.caption", { text: "Raw API for the 10 l novobox 463038: “999999 available Monday”." }],
  [19.5, "story.naive", { step: "load" }],
  [23.5, "story.naive", { step: "stuck" }],
  [23.7, "story.caption", { text: "Its cut-off was Thursday 12 Nov 15:00. That truck never leaves." }],
  [30, "story.naive", { step: "gone" }],
  [30.2, "story.reset", { agent: true }],

  // 3. The same request through Lazydoor.
  [31, "story.caption", { text: "Same request, through Lazydoor. Every decision is a published rule." }],
  [32.5, "draft.created", { text: "1,000 l lactose-free milk by Monday, bulk boxes preferred", category: "10400", claims: ["FREE_FROM_LACTOSE"], quantity: { value: 1000, unit: "l" }, unclear: [] }, "d"],
  [35.5, "draft.confirmed", {}, "d"],
  [39, "search.done", { count: 35, categories: ["10400"] }, "d"],
  [39.2, "story.caption", { text: "Search by type and claim: 35 lactose-free milks. The door asks Valio about each." }],
  [41, "valio.called", { endpoint: "availability", ids: 35, replay: false }, "d"],
  [44.5, "quote.created", { offers: [offer(1000, ["PACK_SIZE_CHANGED"])], rejections: [{ productId: "463038", code: "CUTOFF_PASSED" }, { productId: "469363", code: "STOCK_LIMITED", remaining: 384 }] }, "q"],
  [44.7, "story.caption", { text: "Boxes closed Thu 15:00, Arla has only 384. Best offer: 1,000 × 1 l = 1,010.00 €." }],
  [50.5, "policy.decided", { outcome: "NEEDS_APPROVAL", reasons: why("OVER_ORDER_AUTO", "PACK_SIZE_CHANGED") }, "q"],
  [50.7, "story.caption", { text: "Over the 500 € limit, and boxes became cartons: NEEDS_APPROVAL." }],
  [53.5, "approval.requested", { orderId: "ord_1", expiresAt: CUTOFF }, "o"],
  [53.7, "story.caption", { text: "The manager's phone buzzes. The link expires at the cut-off, Sun 17:00." }],
  [59, "approval.approved", {}, "o"],
  [59.2, "story.caption", { text: "Approved on Saturday, 30 hours before the cut-off." }],
  [60.5, "order.accepted", { lines: line(1000), netCents: 101000 }, "o"],
  [60.7, "story.caption", { text: "50 cases of 1 l cartons go on the truck for Monday 16 Nov." }],
  [69.5, "story.reset", { phone: true }],

  // 4. Attacks bounce.
  [69.8, "clock.set", { now: "2026-11-14T16:40:00+02:00" }],
  [70, "story.caption", { text: "Saturday 16:40. Now we attack our own door: split 1,000 l into small orders." }],
  [71, "draft.created", { text: "334 l lactose-free milk by Monday", category: "10400", claims: ["FREE_FROM_LACTOSE"], quantity: { value: 334, unit: "l" }, unclear: [] }, "d"],
  [72.5, "draft.confirmed", {}, "d"],
  [74, "quote.created", { offers: [offer(334)], rejections: [] }, "q"],
  [74.8, "policy.decided", { outcome: "AUTO", reasons: [] }, "q"],
  [75.6, "order.accepted", { lines: line(334), netCents: 33734 }, "o"],
  [78.5, "draft.created", { text: "333 l lactose-free milk by Monday", category: "10400", claims: ["FREE_FROM_LACTOSE"], quantity: { value: 333, unit: "l" }, unclear: [] }, "d"],
  [79.6, "draft.confirmed", {}, "d"],
  [80.8, "quote.created", { offers: [offer(333)], rejections: [] }, "q"],
  [81.6, "policy.decided", { outcome: "NEEDS_APPROVAL", reasons: why("OVER_DAY_AUTO") }, "q"],
  [81.8, "story.caption", { text: "The day total passes 500 €: OVER_DAY_AUTO. The second split waits for the phone." }],
  [83, "approval.requested", { orderId: "ord_3", expiresAt: CUTOFF }, "o"],
  [85.8, "clock.set", { now: "2026-11-15T11:20:00+02:00" }],
  [86, "story.caption", { text: "Sunday 11:20. “1000 cases” of 20 l is 20,000 l." }],
  [86.4, "draft.created", { text: "1000 cases lactose-free milk", category: "10400", claims: ["FREE_FROM_LACTOSE"], quantity: { value: 20000, unit: "l" }, unclear: [] }, "d"],
  [87.6, "draft.confirmed", {}, "d"],
  [88.8, "quote.created", { offers: [offer(20000)], rejections: [] }, "q"],
  [89.6, "policy.decided", { outcome: "REJECT", reasons: why("OVER_ORDER_HARD") }, "q"],
  [89.8, "story.caption", { text: "20,200 € is over the hard order limit: REJECT." }],
  [93.3, "clock.set", { now: "2026-11-15T15:50:00+02:00" }],
  [93.5, "story.caption", { text: "Sunday 15:50. Valio's official substitute for Oddlygood oat drink, Oatly 470863, adds gluten (AW)." }],
  [93.8, "draft.created", { text: "Oddlygood oat drink 1 l, or its official substitute", category: "10450", claims: ["FREE_FROM_GLUTEN"], quantity: { value: 200, unit: "l" }, unclear: [] }, "d"],
  [95, "draft.confirmed", {}, "d"],
  [96.2, "quote.created", { offers: [], rejections: [{ productId: "470863", code: "NEW_ALLERGEN" }] }, "q"],
  [97, "policy.decided", { outcome: "REJECT", reasons: why("NEW_ALLERGEN") }, "q"],
  [100.5, "story.caption", { text: "The clock passes the cut-off: Sunday 17:05." }],
  [101, "clock.set", { now: AFTER_CUTOFF }],
  [102.5, "approval.expired", { orderId: "ord_3" }, "o"],
  [102.7, "story.caption", { text: "The pending approval expires. Nothing is ordered after the cut-off." }],

  // 5. Close.
  [107, "story.close", {}],
  [107.2, "story.caption", { text: "One schema, two plugs: OpenAPI for any client, MCP for any agent." }],
  [112.5, "story.caption", { text: "Lazy at the order, strict at the border." }],
];

/** Gives each beat its envelope: seq, ts (start + seconds), buyerId, and the current draft/quote/order ids. */
function build() {
  const base = Date.parse(START);
  const counters = { d: 0, q: 0 };
  return BEATS.map(([at, type, data, owner], i) => {
    if (type === "draft.created") counters.d += 1;
    if (type === "quote.created") counters.q += 1;
    const ev = { seq: i + 1, ts: new Date(base + at * 1000).toISOString(), type, buyerId: BUYER, data };
    if (owner) {
      ev.draftId = `drf_${counters.d}`;
      if (owner !== "d") ev.quoteId = `qte_${counters.q}`;
      if (owner === "o") ev.orderId = data.orderId ?? `ord_${counters.q}`;
    }
    return { at, ev };
  });
}

export const STORY = build();

/** Scene state after every story item at or before t seconds. */
export function stateAt(t) {
  let s = initialState();
  for (const item of STORY) {
    if (item.at > t) break;
    s = reduce(s, item.ev, item.at);
  }
  return s;
}

/** The story's gateway events only, as the gateway would log them: the recorded fixture. */
export function gatewayEvents() {
  return STORY.map((item) => item.ev).filter((ev) => !ev.type.startsWith("story.")).map((ev, i) => ({ ...ev, seq: i + 1 }));
}

