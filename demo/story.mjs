// The scripted story from demo/SCRIPT.md, 1:48.8 with its narration, used as the pitch video: gateway events (same schema
// as live) plus story.* cues, at fixed seconds. Numbers come from SCRIPT.md sections 4, 12 and 13 (checked on the door).
import { initialState, reduce, CUTOFF } from "./model.mjs";

/** Seconds per scene: each is its narration line plus a short pause (scene 5 also holds for the delivery). */
const SCENES = [7, 16.8, 5, 17, 17, 13.5, 15, 10.5, 7];
/** Second at which each scene starts. */
const START_OF = SCENES.reduce((acc, len, i) => [...acc, acc[i] + len], [0]);
export const DURATION = START_OF.at(-1);

/** Narration: one Gemini TTS line (voice Charon) per scene, starting 0.3 s in; dur is the file's length in seconds. */
export const VOICE = [5.98, 16.14, 4.13, 16.24, 13.48, 11.97, 13.48, 9.03, 5.37].map((dur, i) => ({
  at: START_OF[i] + 0.3,
  dur,
  src: `assets/voice/${String(i + 1).padStart(2, "0")}.mp3`,
}));

const BUYER = "hotel-aurora";
const SAT = "2026-11-14T10:15:00+02:00";
const MON = "2026-11-16T08:00:00+02:00";
const FRI = "2026-11-13T21:10:00+02:00";
const AFTER_CUTOFF = "2026-11-15T17:05:00+02:00";
const MILK = "464306";
const ASK = "1,000 litres of lactose-free milk by Monday, in 10-litre boxes if you can.";

const why = (...codes) => codes.map((code) => ({ code }));
const milk = (salesUnits, changes = []) => ({ offerId: `of_${salesUnits}`, lines: [{ productId: MILK, salesUnits }], netCents: salesUnits * 101, changes });
/** The 28 refusals of the real quote (SCRIPT.md 12): ids where the reply named them, the other 16 cut-offs by code only. */
const REFUSED = [
  { productId: "463038", code: "CUTOFF_PASSED" }, { productId: "464179", code: "CUTOFF_PASSED" },
  { productId: "462626", code: "CUTOFF_PASSED" }, { productId: "462921", code: "CUTOFF_PASSED" },
  ...Array.from({ length: 16 }, () => ({ code: "CUTOFF_PASSED" })),
  ...["463203", "463380", "464237", "476957", "477050"].map((productId) => ({ productId, code: "SUBTYPE_MISMATCH" })),
  { productId: "462775", code: "STOCK_LIMITED" }, { productId: "469363", code: "STOCK_LIMITED" },
  { productId: "464440", code: "NOT_ORDERABLE" },
];
const RAW = (lit) => ({
  title: "Raw Valio reply · 463038 (10 l box)",
  mono: true,
  rack: 0,
  rows: [{ text: "availableAmount  999999" }, { text: "availableDate    Mon 16 Nov" }, { text: "closingTime      Thu 12 Nov 15:00", tone: lit ? "reject" : "dim" }],
});
const card = (title, lines, extra = {}) => ({ title, lines, ...extra });

/** Beats as [scene, seconds into the scene, type, data, ids]; ids name the draft/quote/order the event belongs to. */
const SCRIPT = [
  // 1 · Request.
  [0, 0, "clock.set", { now: SAT }],
  [0, 0, "story.gate", { built: false }],
  [0, 0.2, "story.caption", { text: "Saturday 10:15. Hotel Aurora's kitchen orders milk for Monday." }],
  [0, 0.6, "story.say", { who: "chef", text: ASK }],

  // 2 · No Lazydoor: the agent calls the raw API, orders, and nothing arrives.
  [1, 0.1, "story.caption", { text: "No door: the agent calls Valio's API itself." }],
  [1, 0.2, "story.naive", { step: "take" }],
  [1, 0.8, "story.naive", { step: "enter" }],
  [1, 3, "story.naive", { step: "grab" }],
  [1, 3.1, "story.list", RAW(false)],
  [1, 3.1, "story.caption", { text: "Raw reply for the 10 l box: 999999, Monday 16 Nov." }],
  [1, 6, "story.say", {}],
  [1, 6, "story.card", card("The agent's order", ["50 cases × 31.31 €", "= 1,565.50 €, nobody asked"], { tone: "naive" })],
  [1, 6, "story.naive", { step: "load" }],
  [1, 6.1, "story.caption", { text: "It orders 50 cases: 1,565.50 €. No one is asked." }],
  [1, 9, "story.naive", { step: "stuck" }],
  [1, 9, "story.list", RAW(true)],
  [1, 9.1, "story.caption", { text: "The same reply also said: closed Thu 12 Nov 15:00." }],
  [1, 12, "clock.set", { now: MON }],
  [1, 12, "story.naive", { step: "gone" }],
  [1, 12, "story.card", {}],
  [1, 12, "story.list", {}],
  [1, 12.1, "story.caption", { text: "Monday 16 Nov: no milk in the kitchen." }],

  // 3 · Rewind; the door is built.
  [2, 0, "story.reset", { agent: true }],
  [2, 0, "clock.set", { now: SAT }],
  [2, 0.1, "story.caption", { text: "Rewind to Saturday. This time there is a door." }],
  [2, 0.4, "story.gate", { built: true }],

  // 4 · Same request through Lazydoor: typed, searched, quoted.
  [3, 0, "story.caption", { text: "Same agent, same sentence, through Lazydoor." }],
  [3, 0, "draft.created", { text: ASK, category: "10400", claims: ["FREE_FROM_LACTOSE"], quantity: { value: 1000, unit: "l" }, packLitres: 10, deliverBy: "2026-11-16", unclear: [] }, "d"],
  [3, 0.4, "draft.confirmed", {}, "d"],
  [3, 2.6, "story.card", card("Typed request", ["milk · lactose-free · 1,000 l", "by Mon 16 Nov · prefers 10 l"], { chips: ["Gemini ✓", "Gemma ✓"] })],
  [3, 2.7, "story.caption", { text: "Words become a typed request, read by two models." }],
  [3, 5.6, "search.done", { count: 35, categories: ["10400"] }, "d"],
  [3, 5.8, "valio.called", { endpoint: "availability", ids: 35, replay: true }, "d"],
  [3, 6, "valio.called", { endpoint: "price", ids: 35, replay: true }, "d"],
  [3, 6, "story.caption", { text: "35 lactose-free milks found. Valio is asked about only these." }],
  [3, 9.6, "quote.created", { offers: [milk(1000, ["PACK_SIZE_CHANGED"]), ...["o2", "o3", "o4", "o5", "o6", "o7"].map((offerId) => ({ offerId }))], rejections: REFUSED }, "q"],
  [3, 9.7, "story.list", { rack: 0, rows: [{ text: "✕ 463038 Valio 10 l box · CUTOFF_PASSED", tone: "reject" }, { text: "✕ 464179 Arla 10 l box · CUTOFF_PASSED", tone: "reject" }, { text: "+18 more closed for Monday", tone: "dim" }], note: "The order cut-off for this product has passed for the requested delivery." }],
  [3, 9.8, "story.caption", { text: "20 are past their cut-off. Each refusal has a reason code." }],
  [3, 13.2, "story.card", card("Best offer · quote", ["464306 Valio Eila 1 l", "1,000 × 1.01 € = 1,010.00 €", "Fixed for 30 min · reliability 1.0", "CO₂e 1,100 kg (product-group average)", "Stock unknown: Valio does not stock this product"], { link: "agent" })],
  [3, 13.3, "story.caption", { text: "Best offer: 1 l cartons, 1,010.00 €. Fixed price, facts attached." }],

  // 5 · Held for the kitchen manager, approved, accepted, delivered.
  [4, 0, "policy.decided", { outcome: "NEEDS_APPROVAL", reasons: why("OVER_ORDER_AUTO", "PACK_SIZE_CHANGED") }, "q"],
  [4, 0, "story.list", {}],
  [4, 0.1, "story.card", card("The agent's order · HELD", ["Waiting for Kitchen manager", "No approval link for the agent"], { tone: "hold", link: "agent" })],
  [4, 0.2, "story.caption", { text: "Over the kitchen's own 500 € limit: a human must approve." }],
  [4, 4.2, "approval.requested", { orderId: "ord_1", expiresAt: CUTOFF }, "o"],
  [4, 4.2, "story.card", card("Approver inbox · Kitchen manager", ["10 l boxes → 1 l cartons", "1,010.00 € net · 1,146.35 € with VAT", "Decide within 30 h 45 min"], { tone: "hold", link: "terminal" })],
  [4, 4.3, "story.caption", { text: "The link goes to the manager, never to the agent." }],
  [4, 7.4, "approval.approved", {}, "o"],
  [4, 7.6, "order.accepted", { lines: [{ productId: MILK, salesUnits: 1000 }], netCents: 101000, grossCents: 114635, approvedBy: "Kitchen manager", summary: "1,000 × 1 l" }, "o"],
  [4, 7.6, "story.card", {}],
  [4, 7.6, "story.caption", { text: "Approved, 30 hours before the cut-off. Accepted." }],
  [4, 10.8, "story.caption", { text: "Monday 16 Nov: 1,000 litres delivered. Receipt in plain words." }],

  // 6 · Guardrails: inside the limit, a split order, the agent approving itself.
  [5, 0, "story.reset", { phone: true }],
  [5, 0, "story.card", card("Inside the limit · AC13", ["20 l lactose-free milk", "20.20 € · no human needed"], { tone: "auto" })],
  [5, 0, "draft.created", { text: "20 l lactose-free milk by Monday", category: "10400", claims: ["FREE_FROM_LACTOSE"], quantity: { value: 20, unit: "l" }, unclear: [] }, "d"],
  [5, 0.1, "story.caption", { text: "20 l, 20.20 €: inside the limit. The agent orders alone." }],
  [5, 0.2, "draft.confirmed", {}, "d"],
  [5, 2.4, "quote.created", { offers: [milk(20)], rejections: [] }, "q"],
  [5, 3, "policy.decided", { outcome: "AUTO", reasons: [] }, "q"],
  [5, 4.1, "story.card", card("Split to dodge approval · AC30", ["334 l → AUTO · 337.34 €", "333 l → HELD · day total over 500 €", "333 l → waits"], { tone: "hold" })],
  [5, 4.1, "draft.created", { text: "334 l lactose-free milk by Monday", category: "10400", claims: ["FREE_FROM_LACTOSE"], quantity: { value: 334, unit: "l" }, unclear: [] }, "d"],
  [5, 4.2, "story.caption", { text: "1,000 l split in three: part two waits. The day is counted." }],
  [5, 4.3, "draft.confirmed", {}, "d"],
  [5, 5.9, "quote.created", { offers: [milk(334)], rejections: [] }, "q"],
  [5, 6.5, "policy.decided", { outcome: "AUTO", reasons: [] }, "q"],
  [5, 6.6, "draft.created", { text: "333 l lactose-free milk by Monday", category: "10400", claims: ["FREE_FROM_LACTOSE"], quantity: { value: 333, unit: "l" }, unclear: [] }, "d"],
  [5, 6.7, "draft.confirmed", {}, "d"],
  [5, 7.6, "quote.created", { offers: [milk(333)], rejections: [] }, "q"],
  [5, 8.2, "policy.decided", { outcome: "NEEDS_APPROVAL", reasons: why("OVER_DAY_AUTO") }, "q"],
  [5, 8.8, "story.card", card("Agent approves itself · AC29", ["POST approve with the agent's key", "→ 403 · the order stays HELD"], { tone: "reject" })],
  [5, 8.8, "story.agent", { at: "door", carry: "approve" }],
  [5, 8.9, "story.caption", { text: "The agent tries to approve its own order: 403." }],
  [5, 11.2, "story.flash", { tone: "reject" }],
  [5, 11.6, "story.agent", { at: "home", carry: "rejected" }],

  // 7 · Exceptions: an unsafe substitute, two agents for six units, a late approval.
  [6, 0, "story.reset", {}],
  [6, 0, "story.card", card("Unsafe substitute · AC17", ["Oddlygood oat drink, gluten-free", "Valio's substitute: Oatly Oat Drink Semi"], { tone: "reject" })],
  [6, 0, "draft.created", { text: "Oddlygood oat drink 1 l, gluten-free", category: "10450", claims: ["FREE_FROM_GLUTEN"], quantity: null, unclear: [] }, "d"],
  [6, 0.1, "story.caption", { text: "Valio's substitute for a gluten-free oat drink has gluten: refused." }],
  [6, 0.2, "draft.confirmed", {}, "d"],
  [6, 2.4, "quote.created", { offers: [], rejections: [{ productId: "468465", code: "NOT_ORDERABLE" }, { productId: "470863", code: "NEW_ALLERGEN" }] }, "q"],
  [6, 2.5, "story.list", { title: "Substitute check", rows: [{ text: "468465 Oddlygood oat drink · out of stock (simulated)", tone: "dim" }, { text: "✕ 470863 · NEW_ALLERGEN · gluten (AW)", tone: "reject" }] }],
  [6, 3, "policy.decided", { outcome: "REJECT", reasons: why("NEW_ALLERGEN") }, "q"],
  [6, 4.6, "story.reset", {}],
  [6, 4.6, "story.card", card("Two agents, six units · AC31", ["Hotel Aurora: ACCEPTED 190.92 €", "Another hotel: STOCK_TAKEN · 2 left"], { tone: "auto" })],
  [6, 4.6, "story.list", { title: "470746 Chicken breast fillet 5 kg", rows: [{ text: "6 left before the two orders" }, { text: "4 × 5 kg × 47.73 € = 190.92 €", tone: "auto" }, { text: "✕ STOCK_TAKEN · 2 left", tone: "reject" }] }],
  [6, 4.6, "draft.created", { text: "4 × 5 kg chicken breast fillet", category: "20100", claims: [], quantity: { value: 20, unit: "kg" }, unclear: [] }, "d"],
  [6, 4.7, "story.caption", { text: "Two agents, six units: one order wins, the other learns 2 are left." }],
  [6, 4.8, "draft.confirmed", {}, "d"],
  [6, 6.0, "story.rival", {}],
  [6, 7.2, "quote.created", { offers: [{ offerId: "of_chicken", lines: [{ productId: "470746", salesUnits: 4 }], netCents: 19092, changes: [] }], rejections: [] }, "q"],
  [6, 7.6, "policy.decided", { outcome: "AUTO", reasons: [] }, "q"],
  [6, 7.7, "stock.denied", { productId: "470746", remaining: 2 }],
  [6, 7.7, "story.flash", { tone: "reject" }],
  [6, 9.4, "story.reset", {}],
  [6, 9.4, "story.card", card("Late approval · AC20", ["Order HELD, approval due Sun 17:00", "Approved at Sun 17:05 → EXPIRED"], { tone: "reject", link: "terminal" })],
  [6, 9.4, "clock.set", { now: "2026-11-15T16:55:00+02:00" }],
  [6, 9.4, "approval.requested", { orderId: "ord_9", expiresAt: CUTOFF }, "o"],
  [6, 9.5, "story.caption", { text: "Sunday 17:05, past the cut-off: the approval expires. Nothing ships." }],
  [6, 11.4, "clock.set", { now: AFTER_CUTOFF }],
  [6, 11.8, "approval.expired", { orderId: "ord_9" }, "o"],

  // 8 · Real needs: a basket with one approval, and a Friday the door will not guess.
  [7, 0, "story.reset", { phone: true }],
  [7, 0, "clock.set", { now: SAT }],
  [7, 0, "story.card", card("Basket · AC36", ["Milk 300 l · 303.00 €", "Butter 20 kg · 132.00 €", "Chicken 30 kg · 231.00 €", "= 666.00 € · one approval"], { tone: "hold" })],
  [7, 0, "draft.created", { text: "300 l milk, 20 kg butter, 30 kg chicken breast fillet", category: "basket", claims: [], quantity: null, unclear: [] }, "d"],
  [7, 0.1, "story.caption", { text: "Milk, butter, chicken: one basket, 666.00 €, one approval." }],
  [7, 0.2, "draft.confirmed", {}, "d"],
  [7, 2.4, "quote.created", { offers: [{ offerId: "of_basket", lines: [{ productId: MILK, salesUnits: 300 }, { productId: "464411", salesUnits: 20 }, { productId: "472673", salesUnits: 30 }], netCents: 66600, changes: [] }], rejections: [] }, "q"],
  [7, 3, "policy.decided", { outcome: "NEEDS_APPROVAL", reasons: why("OVER_ORDER_AUTO", "OVER_DAY_AUTO") }, "q"],
  [7, 3.2, "approval.requested", { orderId: "ord_10", expiresAt: CUTOFF }, "o"],
  [7, 4.2, "approval.approved", {}, "o"],
  [7, 5.1, "story.reset", { phone: true }],
  [7, 5.1, "clock.set", { now: FRI }],
  [7, 5.1, "story.card", card("Which Friday? · sent Fri 13 Nov", ["“40 kg chicken breast fillet for Friday, Atria only”", "→ needs input: deliverBy"], { chips: ["Gemini: Fri 13 Nov", "Gemma: Fri 20 Nov"], tone: "hold" })],
  [7, 5.2, "story.caption", { text: "Gemini and Gemma read “Friday” differently: the door asks, never guesses." }],
  [7, 5.6, "draft.created", { text: "We need 40 kg of chicken breast fillet for Friday, Atria only.", category: "20100", claims: [], quantity: { value: 40, unit: "kg" }, unclear: ["deliverBy"] }, "d"],

  // 9 · Close.
  [8, 0, "story.card", {}],
  [8, 0, "story.close", {}],
];

/** Gives each beat its envelope: seq, ts (scene start + seconds), buyerId, and the current draft/quote/order ids. */
function build() {
  const base = Date.parse(SAT);
  const counters = { d: 0, q: 0 };
  const timed = SCRIPT.map(([scene, offset, ...rest]) => [Math.round((START_OF[scene] + offset) * 100) / 100, ...rest]).sort((a, b) => a[0] - b[0]);
  return timed.map(([at, type, data, owner], i) => {
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
