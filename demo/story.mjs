// The scripted story v2.1 from demo/SCRIPT.md section 14: one kitchen, one agent, Friday to Monday, 1:50 with its narration,
// used as the pitch video. Gateway events come from one data file, fixtures/story-v2.json (the chain run once on the live
// door, section 14.6); this file only says when each of them happens and adds the story.* cues around them.
import { initialState, reduce } from "./model.mjs";
import fixture from "./fixtures/story-v2.json" with { type: "json" };

/**
 * Seconds per scene: each is its narration line plus a short pause (scene 10 also holds for the delivery and receipt, the
 * last one holds the "Without the door / With Lazydoor" comparison and then the end card). The Story must stay under 1:59.
 */
const SCENES = [20.4, 5.9, 16.6, 12.9, 12.4, 7.8, 5, 6.5, 12.8, 7, 11.6];
/** Second at which each scene starts. */
const START_OF = SCENES.reduce((acc, len, i) => [...acc, Math.round((acc[i] + len) * 100) / 100], [0]);
export const DURATION = START_OF.at(-1);

/** Seconds into scene 1 where the flash-forward to Monday's line starts, and where the rewind (and its sound) starts. */
const MONDAY_LINE = 15.2;
const REWIND = 18.4;
const at = (scene, offset) => Math.round((START_OF[scene] + offset) * 100) / 100;

/**
 * Narration: Gemini TTS lines (voice Charon), one per scene starting 0.3 s in, plus scene 1's consequence line "So on
 * Monday morning, there is no milk." (file 12, added last, played right after line 1); dur is each file's length in seconds.
 */
export const VOICE = [
  { at: at(0, 0.3), dur: 14.61, src: "assets/voice/01.mp3" },
  { at: at(0, MONDAY_LINE), dur: 2.92, src: "assets/voice/12.mp3" },
  ...[5.12, 15.53, 12.26, 11.83, 7.11, 4.34, 5.92, 12.07, 5.13, 4.79].map((dur, i) => ({ at: at(i + 1, 0.3), dur, src: `assets/voice/${String(i + 2).padStart(2, "0")}.mp3` })),
];

/** Sound effects on the same track as the narration: the tape-rewind whoosh under the "Rewind" in scene 1 (ffmpeg-made). */
export const SFX = [{ at: at(0, REWIND), dur: 1.7, src: "assets/sfx/rewind.mp3" }];

const ASK = "1,000 litres of lactose-free milk by Monday, in 10-litre boxes if you can.";
const FRIDAY = "We need 40 kg of chicken breast fillet for Friday, Atria only.";
const RAW = (lit) => ({
  title: "Raw Valio reply · 463038 (10 l box)",
  mono: true,
  rack: 0,
  rows: [{ text: "availableAmount  999999" }, { text: "availableDate    Mon 16 Nov" }, { text: "closingTime      Thu 12 Nov 15:00", tone: lit ? "reject" : "dim" }],
});
const card = (title, lines, extra = {}) => ({ title, lines, ...extra });
const caption = (text) => ["story.caption", { text }];
const gw = (type) => ["gw", type];

/**
 * Beats as [scene, seconds into the scene, type, data]. ["gw", type] takes the fixture's next events up to and including
 * the next one of that type, all at that second, so the timeline names only the events it times.
 */
const SCRIPT = [
  // 1 · Friday 16:30, no door: the agent calls Valio's API itself and orders boxes that closed on Thursday.
  [0, 0, "story.hold", {}],
  [0, 0, "story.clock", { now: "2026-11-13T16:30:00+02:00" }],
  [0, 0, "story.gate", { built: false }],
  [0, 0.1, ...caption("Friday 16:30. Hotel Aurora's chef orders milk for Monday.")],
  [0, 0.5, "story.say", { who: "chef", text: ASK }],
  [0, 3.5, ...caption("No door: the agent calls Valio's API itself.")],
  [0, 4, "story.naive", { step: "take" }],
  [0, 4.3, "story.naive", { step: "enter" }],
  [0, 6.5, "story.naive", { step: "grab" }],
  [0, 6.5, "story.list", RAW(false)],
  [0, 6.5, ...caption("Raw reply for the 10 l box: 999999, Monday 16 Nov.")],
  [0, 9.5, "story.say", {}],
  [0, 9.5, "story.card", card("The agent's order", ["50 cases × 31.31 € = 1,565.50 €", "No one checked, no one approved"], { tone: "naive", link: "agent" })],
  [0, 9.5, "story.naive", { step: "load" }],
  [0, 9.5, ...caption("It orders 50 cases: 1,565.50 €. No one is asked.")],
  [0, 12.5, "story.naive", { step: "stuck" }],
  [0, 12.5, "story.list", RAW(true)],
  [0, 12.5, ...caption("Nobody checked. Nobody approved.")],
  [0, 12.5, "story.card", card("The agent's order · never ships", ["50 cases × 31.31 € = 1,565.50 €", "Past the Thu 15:00 cut-off"], { tone: "reject", link: "agent" })],
  [0, 13.2, "story.agent", { at: "home", carry: null }],
  // Flash-forward to Monday: no milk arrives. Then rewind to Friday, before the door goes up.
  [0, 15, "story.warp", { to: "2026-11-16T07:00:00+02:00", dur: 0.9 }],
  [0, 15, "story.naive", { step: "gone" }],
  [0, 15, "story.list", {}],
  [0, 15.5, "story.nomilk", { on: true }],
  [0, 15.5, ...caption("So on Monday morning, there is no milk.")],
  [0, 15.5, "story.card", card("Monday 16 Nov · 07:00", ["No milk: the 50 cases never shipped", "Nobody checked, nobody approved"], { tone: "reject", link: "terminal" })],
  [0, REWIND, "story.nomilk", { on: false }],
  [0, REWIND, "story.card", {}],
  [0, REWIND, "story.warp", { to: "2026-11-13T16:30:00+02:00", dur: 1.8 }],
  [0, 18.5, ...caption("Rewind to Friday. This time, there is a door.")],

  // 2 · Friday evening: the door goes up and the kitchen manager's phone sends it the kitchen's signed rules.
  [1, 0, "story.reset", { truck: true, agent: true }],
  [1, 0, "story.warp", { to: "2026-11-13T19:40:00+02:00", dur: 1.2 }],
  [1, 1.1, ...caption("One door at Valio. Each kitchen brings its own signed rules.")],
  [1, 0.3, "story.gate", { built: true }],
  [1, 2.2, "story.mandates", {}],
  [1, 2.2, "story.card", card("One door, each kitchen's own rules", ["Hotel Aurora · signed by its kitchen", "Kitchen B · its own signed rules", "Kitchen C · its own signed rules"], { link: "rack" })],
  [1, 4, "story.rules", { on: true }],

  // 3 · 21:10, the same sentence through the door: typed, searched, refused with reasons, quoted.
  [2, 0, ...gw("clock.set")],
  [2, 0.1, ...caption("21:10. Same agent, same sentence, now through the door.")],
  [2, 0.1, "story.card", card("The chef's sentence", ["“1,000 litres of lactose-free milk by Monday,", "in 10-litre boxes if you can.”"], { link: "terminal" })],
  [2, 0.6, ...gw("draft.created")],
  [2, 1.2, ...gw("draft.confirmed")],
  [2, 3.4, "story.card", card("Typed request", ["milk · lactose-free · 1,000 l", "by Mon 16 Nov · prefers 10 l"], { chips: ["Gemini ✓", "Gemma ✓"], link: "agent" })],
  [2, 3.4, ...caption("Words become a typed request, read by two models.")],
  [2, 6.5, ...gw("search.done")],
  [2, 6.5, ...caption("35 lactose-free milks: Valio is asked about these.")],
  [2, 6.8, ...gw("valio.called")],
  [2, 7, ...gw("valio.called")],
  [2, 9.6, ...gw("quote.created")],
  [2, 9.7, "story.list", { title: "20 candidates not offered", product: "463038", rows: [{ text: "✕ 463038 Valio 10 l box · CUTOFF_PASSED", tone: "dim" }, { text: "✕ 464179 Arla 10 l box · CUTOFF_PASSED", tone: "dim" }, { text: "+18 more closed for Monday", tone: "dim" }] }],
  [2, 9.7, ...caption("20 are past their cut-off. Each refusal has a reason code.")],
  [2, 13.1, "story.card", card("Best offer · quote", ["464306 Valio Eila 1 l", "1,000 × 1.01 € = 1,010.00 €", "Fixed for 30 min · reliability 1", "CO₂e 1,100 kg (product-group average)", "Stock unknown: Valio does not stock this product"], { link: "agent" })],
  [2, 13.2, ...caption("Best offer: 1 l cartons, 1,010.00 €, fixed for 30 minutes.")],

  // 4 · Over the kitchen's limit per order: held; Lazydoor asks the manager's phone; the agent's own approval gets 403.
  [3, 0, ...gw("policy.decided")],
  [3, 0, "story.list", {}],
  [3, 0.1, "story.card", card("The agent's order · HELD", ["1,010.00 € is over 500 € an order", "Waiting for the Kitchen manager"], { tone: "hold", link: "agent" })],
  [3, 0.1, ...caption("Over the kitchen's own 500 € order limit: the door holds it.")],
  [3, 3.7, ...gw("approval.requested")],
  [3, 3.7, ...caption("Lazydoor sends the request to the kitchen manager. Not Valio. Not the agent.")],
  [3, 5, "story.card", card("Kitchen manager's phone", ["Approve order · 1,000 × 1 l", "Net 1,010.00 € · Gross 1,146.35 €", "Decide within 43 h 50 min"], { tone: "hold", link: "phone" })],
  [3, 8.3, "story.agent", { at: "door", carry: "approve" }],
  [3, 8.3, "story.card", card("The agent approves its own order", ["POST /approve with the agent's own key", "→ 403 AGENT_CANNOT_APPROVE · still HELD"], { tone: "reject", link: "agent" })],
  [3, 8.3, ...caption("The agent tries to approve its own order: 403.")],
  [3, 10.9, "story.flash", { tone: "reject" }],
  [3, 11.3, "story.agent", { at: "home", carry: "quote" }],

  // 5 · While the milk waits: chicken by product code, inside both limits; another hotel's agent learns 2 are left.
  [4, 0, "story.card", card("Typed order · no sentence", ["470746 Chicken breast fillet 5 kg", "4 boxes = 20 kg · by Mon 16 Nov"], { link: "agent" })],
  [4, 0, "story.agent", { at: "door", carry: "draft" }],
  [4, 0, "story.list", { title: "470746 Chicken breast fillet 5 kg", rack: 0, rows: [{ text: "6 left before the two orders" }] }],
  [4, 0.1, ...caption("While the milk waits: 20 kg of chicken, by product code.")],
  [4, 1.6, ...gw("search.done")],
  [4, 2.4, ...gw("quote.created")],
  [4, 2.6, "story.rival", {}],
  [4, 3.4, ...gw("quote.created")],
  [4, 3.6, ...caption("Two agents, six boxes: ours wins, the other learns 2 are left.")],
  [4, 4.2, ...gw("policy.decided")],
  [4, 4.4, ...gw("order.accepted")],
  [4, 4.4, "story.card", card("Typed order · ACCEPTED", ["470746 · 4 × 5 kg = 190.92 €", "Accepted Fri · ships Mon 16 Nov"], { tone: "auto", link: "agent" })],
  [4, 5, ...gw("policy.decided")],
  [4, 5.2, ...gw("stock.denied")],
  [4, 5.2, "story.list", { title: "470746 Chicken breast fillet 5 kg · 6 left", product: "470746", rows: [{ text: "Hotel Aurora: ACCEPTED · 190.92 €", tone: "auto" }, { text: "Another hotel: ✕ STOCK_TAKEN · 2 left", tone: "reject" }], note: "Another hotel: same door, its own rules." }],
  [4, 7.4, ...caption("190.92 €: inside both limits, no human. On the pallet for Monday.")],

  // 6 · Still Friday evening: "for Friday" reads as two different Fridays, so the door asks.
  [5, 0, "story.card", {}],
  [5, 0, "story.list", {}],
  [5, 0, "story.say", { who: "chef", text: FRIDAY }],
  [5, 0.1, ...caption("The chef plans ahead: chicken “for Friday”.")],
  [5, 1.6, "story.agent", { at: "door", carry: "draft" }],
  [5, 3.6, ...caption("Gemini reads today, Gemma reads next week: the door asks, never guesses.")],
  [5, 4.2, "story.say", {}],
  [5, 4.2, ...gw("draft.created")],
  [5, 4.2, "story.card", card("Which Friday? · the door asks", ["“…for Friday, Atria only.”", "Needs input: deliverBy"], { chips: ["Gemini: Fri 13 Nov", "Gemma: Fri 20 Nov"], tone: "hold", link: "agent" })],

  // 7 · Saturday 10:15: the manager approves on the phone; the milk is accepted and waits on Monday's pallet.
  [6, 0, ...gw("clock.set")],
  [6, 0, "story.card", {}],
  [6, 0, "story.agent", { at: "home", carry: null }],
  [6, 0.1, ...caption("Saturday 10:15: the manager approves on the phone. Accepted.")],
  [6, 0.8, ...gw("valio.called")],
  [6, 1, ...gw("valio.called")],
  [6, 1.2, ...gw("approval.approved")],
  [6, 2.6, ...gw("order.accepted")],
  [6, 2.6, "story.card", card("Milk · ACCEPTED", ["1,000 × 1 l · 1,010.00 €", "Accepted Sat · ships Mon 16 Nov"], { tone: "auto", link: "agent" })],

  // 8 · Saturday afternoon: the gluten-free oat drink is out; Valio's substitute adds gluten, so the door refuses it.
  [7, 0, "story.reset", {}],
  [7, 0, "story.card", card("Typed order · Saturday afternoon", ["468465 Oddlygood oat drink, gluten-free", "50 l · substitutes allowed"], { link: "agent" })],
  [7, 0, "story.agent", { at: "door", carry: "draft" }],
  [7, 0.1, ...caption("Valio's substitute for a gluten-free oat drink has gluten: refused.")],
  [7, 1.6, ...gw("search.done")],
  [7, 2, ...gw("quote.created")],
  [7, 2.1, "story.list", { title: "Substitute check", product: "470863", rows: [{ text: "468465 Oddlygood · out of stock (simulated)", tone: "dim" }, { text: "Valio's substitute: Oatly Oat Drink Semi", tone: "dim" }, { text: "✕ 470863 · NEW_ALLERGEN · gluten (AW)", tone: "reject" }] }],
  [7, 3, "story.agent", { at: "home", carry: "rejected" }],
  [7, 3, "story.card", card("Substitute refused · no offer", ["Asked for: gluten-free oat drink", "470863 adds allergen AW (gluten)"], { tone: "reject", link: "agent" })],

  // 9 · Sunday: splitting would not help; one basket, one request; the manager taps at 17:05 and it expires.
  [8, 0, ...gw("clock.set")],
  [8, 0, "story.card", {}],
  [8, 0, "story.list", {}],
  [8, 0.1, ...caption("Sunday 15:50. Splitting would not help: the day is counted.")],
  [8, 0.3, "story.split", { step: "float", cents: [30300, 13200, 23100] }],
  [8, 1.8, "story.split", { step: "touch", cents: [30300, 13200, 23100] }],
  [8, 3.6, "story.split", { step: "merge", cents: [30300, 13200, 23100] }],
  [8, 3.6, "story.agent", { at: "door", carry: "draft" }],
  [8, 3.8, "story.card", card("Basket · one order", ["Milk 300 l · 303.00 €", "Butter 20 kg · 132.00 €", "Chicken 30 kg · 231.00 €"], { link: "agent" })],
  [8, 4, ...caption("Milk, butter, chicken: one basket, 666.00 €, one request.")],
  [8, 5.1, ...gw("search.done")],
  [8, 5.5, ...gw("quote.created")],
  [8, 5.9, ...gw("search.done")],
  [8, 6.3, ...gw("quote.created")],
  [8, 6.7, ...gw("search.done")],
  [8, 7.1, ...gw("quote.created")],
  [8, 7.6, ...gw("policy.decided")],
  [8, 7.6, "story.split", {}],
  [8, 8, ...gw("approval.requested")],
  [8, 8.3, "story.card", card("Kitchen manager's phone", ["Approve basket · 3 lines", "Net 666.00 € · Gross 755.91 €", "Decide by Sun 17:00"], { tone: "hold", link: "phone" })],
  [8, 9.2, "story.clock", { now: "2026-11-15T16:59:00+02:00" }],
  [8, 9.6, ...gw("clock.set")],
  [8, 9.5, ...caption("17:05: the manager taps too late. Expired, nothing ships.")],
  [8, 10.4, ...gw("approval.expired")],
  [8, 10.4, "story.card", card("Kitchen manager's phone · 17:05", ["Approve tapped after the 17:00 cut-off", "→ EXPIRED · APPROVAL_EXPIRED"], { tone: "reject", link: "phone" })],

  // 10 · Monday: the pallet goes on the truck; milk and chicken arrive with the door's receipt.
  [9, 0, "story.reset", { phone: true }],
  [9, 0, "story.clock", { now: "2026-11-16T08:00:00+02:00" }],
  [9, 0, "story.rules", { on: false }],
  [9, 0, "story.receipt", { title: "Receipt · 1,000 × 1 l milk", lines: ["Fixed price 1.01 EUR/l · pack 10 l → 1 l", "Net 1,010.00 · Gross 1,146.35 EUR", "Approved by Kitchen manager", "Accepted (simulated) · Mon 16 Nov"] }],
  [9, 0, "story.ship", {}],
  [9, 0.1, ...caption("Monday 16 Nov: milk and chicken arrive. Receipt in plain words.")],

  // 11 · Without the door / With Lazydoor, one row at a time under line 11; then the end card.
  [10, 0, "story.card", {}],
  [10, 0, "story.compare", {}],
  [10, 8.6, "story.close", {}],
];

/** The fixture's gateway events, oldest first (a bare array or { events }). */
const EVENTS = Array.isArray(fixture) ? fixture : fixture.events;

/**
 * Times every beat: story cues at their seconds, and each ["gw", type] beat takes the fixture's next events through the
 * next one of that type. Throws when the fixture and the timeline disagree, so a swapped fixture fails the tests loudly.
 */
function build() {
  let next = 0;
  const items = [];
  for (const [scene, offset, type, data] of SCRIPT) {
    const at = Math.round((START_OF[scene] + offset) * 100) / 100;
    if (type !== "gw") {
      items.push({ at, ev: { type, data } });
      continue;
    }
    const end = EVENTS.findIndex((ev, i) => i >= next && ev.type === data);
    if (end < 0) throw new Error(`story: no ${data} left in the fixture after event ${next}`);
    for (; next <= end; next++) items.push({ at, ev: EVENTS[next] });
  }
  if (next !== EVENTS.length) throw new Error(`story: ${EVENTS.length - next} fixture events are not placed on the timeline`);
  return items
    .map((item, i) => ({ ...item, i }))
    .sort((a, b) => a.at - b.at || a.i - b.i)
    .map(({ at, ev }, i) => ({ at, ev: { ...ev, seq: i + 1 } }));
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

/** The story's gateway events only, as the gateway logged them: the fixture, renumbered in timeline order. */
export function gatewayEvents() {
  return STORY.map((item) => item.ev).filter((ev) => !ev.type.startsWith("story.")).map((ev, i) => ({ ...ev, seq: i + 1 }));
}
