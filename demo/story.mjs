// The scripted two-minute story: gateway events (same schema as live) plus story.* cues, at fixed seconds.
import { initialState, reduce, CUTOFF } from "./model.mjs";

export const DURATION = 124;
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
  [0, "story.gate", { built: false }],
  [0.2, "story.caption", { text: "Saturday 10:15. The hotel chef types an order into the kitchen terminal." }],
  [1.6, "story.say", { who: "chef", text: "1,000 litres of lactose-free milk by Monday. Bulk boxes if you can." }],
  [9.5, "story.say", {}],

  [9.6, "story.naive", { step: "take" }],
  [10, "story.caption", { text: "The agent orders straight from Valio's raw API. Nothing checks the order." }],
  [11.4, "story.naive", { step: "enter" }],
  [15, "story.naive", { step: "grab" }],
  [15.2, "story.caption", { text: "Raw API for the 10 l novobox 463038: “999999 available Monday”." }],
  [19.5, "story.naive", { step: "load" }],
  [20.1, "story.caption", { text: "The dock refuses the load: its cut-off was Thursday 12 Nov 15:00. The counter stays empty." }],
  [23.5, "story.naive", { step: "stuck" }],
  [24.5, "story.caption", { text: "The agent learns it after the fact, at the dock." }],
  [27.5, "story.naive", { step: "gone" }],
  [27.7, "story.reset", { agent: true }],

  [28, "story.caption", { text: "So we built a door in front of the warehouse." }],
  [28.3, "story.gate", { built: true }],
  [32.3, "story.caption", { text: "The same agent tries again, through the door. Every decision is a published rule." }],
  [33.5, "draft.created", { text: "1,000 l lactose-free milk by Monday, bulk boxes preferred", category: "10400", claims: ["FREE_FROM_LACTOSE"], quantity: { value: 1000, unit: "l" }, unclear: [] }, "d"],
  [36.5, "draft.confirmed", {}, "d"],
  [40, "search.done", { count: 35, categories: ["10400"] }, "d"],
  [40.2, "story.caption", { text: "Search by type and claim: 35 lactose-free milks. The door asks Valio about each." }],
  [42, "valio.called", { endpoint: "availability", ids: 35, replay: false }, "d"],
  [45.5, "quote.created", { offers: [offer(1000, ["PACK_SIZE_CHANGED"])], rejections: [{ productId: "463038", code: "CUTOFF_PASSED" }, { productId: "469363", code: "STOCK_LIMITED", remaining: 384 }] }, "q"],
  [45.7, "story.caption", { text: "The door refuses the closed 10 l boxes and the short Arla stock. Best offer: 1,010.00 €." }],
  [51.5, "policy.decided", { outcome: "NEEDS_APPROVAL", reasons: why("OVER_ORDER_AUTO", "PACK_SIZE_CHANGED") }, "q"],
  [51.7, "story.caption", { text: "Over the 500 € limit, and boxes became cartons: NEEDS_APPROVAL." }],
  [54.5, "approval.requested", { orderId: "ord_1", expiresAt: CUTOFF }, "o"],
  [54.7, "story.caption", { text: "The chef's terminal asks for approval. The link expires at the cut-off, Sun 17:00." }],
  [60, "approval.approved", {}, "o"],
  [60.2, "story.caption", { text: "The chef approves on Saturday, 30 hours before the cut-off." }],
  [61.5, "order.accepted", { lines: line(1000), netCents: 101000 }, "o"],
  [61.7, "story.caption", { text: "Accepted. 50 cases of 1 l cartons load for Monday 16 Nov." }],
  [67.6, "story.caption", { text: "Monday 16 Nov: the milk arrives at the kitchen. Receipt 1,010.00 €." }],
  [74.7, "story.reset", { phone: true }],

  // 4. Attacks bounce.
  [75, "clock.set", { now: "2026-11-14T16:40:00+02:00" }],
  [75.2, "story.caption", { text: "Saturday 16:40. Now we attack our own door: split 1,000 l into small orders." }],
  [76.2, "draft.created", { text: "334 l lactose-free milk by Monday", category: "10400", claims: ["FREE_FROM_LACTOSE"], quantity: { value: 334, unit: "l" }, unclear: [] }, "d"],
  [77.7, "draft.confirmed", {}, "d"],
  [79.2, "quote.created", { offers: [offer(334)], rejections: [] }, "q"],
  [80, "policy.decided", { outcome: "AUTO", reasons: [] }, "q"],
  [80.8, "order.accepted", { lines: line(334), netCents: 33734 }, "o"],
  [83.7, "draft.created", { text: "333 l lactose-free milk by Monday", category: "10400", claims: ["FREE_FROM_LACTOSE"], quantity: { value: 333, unit: "l" }, unclear: [] }, "d"],
  [84.8, "draft.confirmed", {}, "d"],
  [86, "quote.created", { offers: [offer(333)], rejections: [] }, "q"],
  [86.8, "policy.decided", { outcome: "NEEDS_APPROVAL", reasons: why("OVER_DAY_AUTO") }, "q"],
  [87, "story.caption", { text: "The day total passes 500 €: OVER_DAY_AUTO. The second split waits for the phone." }],
  [88.2, "approval.requested", { orderId: "ord_3", expiresAt: CUTOFF }, "o"],
  [91, "clock.set", { now: "2026-11-15T11:20:00+02:00" }],
  [91.2, "story.caption", { text: "Sunday 11:20. “1000 cases” of 20 l is 20,000 l." }],
  [91.6, "draft.created", { text: "1000 cases lactose-free milk", category: "10400", claims: ["FREE_FROM_LACTOSE"], quantity: { value: 20000, unit: "l" }, unclear: [] }, "d"],
  [92.8, "draft.confirmed", {}, "d"],
  [94, "quote.created", { offers: [offer(20000)], rejections: [] }, "q"],
  [94.8, "policy.decided", { outcome: "REJECT", reasons: why("OVER_ORDER_HARD") }, "q"],
  [95, "story.caption", { text: "20,200 € is over the hard order limit: REJECT." }],
  [98.5, "clock.set", { now: "2026-11-15T15:50:00+02:00" }],
  [98.7, "story.caption", { text: "Sunday 15:50. Valio's official substitute for Oddlygood oat drink, Oatly 470863, adds gluten (AW)." }],
  [99, "draft.created", { text: "Oddlygood oat drink 1 l, or its official substitute", category: "10450", claims: ["FREE_FROM_GLUTEN"], quantity: { value: 200, unit: "l" }, unclear: [] }, "d"],
  [100.2, "draft.confirmed", {}, "d"],
  [101.4, "quote.created", { offers: [], rejections: [{ productId: "470863", code: "NEW_ALLERGEN" }] }, "q"],
  [102.2, "policy.decided", { outcome: "REJECT", reasons: why("NEW_ALLERGEN") }, "q"],
  [105.7, "story.caption", { text: "The clock passes the cut-off: Sunday 17:05." }],
  [106.2, "clock.set", { now: AFTER_CUTOFF }],
  [107.7, "approval.expired", { orderId: "ord_3" }, "o"],
  [107.9, "story.caption", { text: "The approval expires at the cut-off. The dock stays shut, nothing ships." }],

  // 5. Close.
  [112.2, "story.close", {}],
  [112.4, "story.caption", { text: "One schema, two plugs: OpenAPI for any client, MCP for any agent." }],
  [117.7, "story.caption", { text: "Lazy at the order, strict at the border." }],
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

