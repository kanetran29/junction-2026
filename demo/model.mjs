// Pure scene model: gateway events (docs/events.md schema) and story cues in, scene state out.

export const SHELVES = 4;
export const CUTOFF = "2026-11-15T17:00:00+02:00";
/** The delivery day of every order in the demo chain: the truck runs then, not when an order is accepted. */
const DELIVERY_DAY = "2026-11-16";
const LOG_KEEP = 9;
const OUTCOMES = new Set(["AUTO", "NEEDS_APPROVAL", "REJECT"]);
const CROSSING = new Set(["NEW_ALLERGEN", "SUBTYPE_MISMATCH", "CLAIM_MISSING", "TEMP_CLASS_CHANGED", "UNIT_MISMATCH", "BRAND_EXCLUDED"]);

/** Empty shelf slot; productId null means nothing is shown on its tag. */
const emptyShelf = () => ({ productId: null, status: "idle", remaining: null, code: null, more: 0, since: 0 });

/** The scene before any event: the robot parked at the foot of the kitchen terminal, the door standing and idle, truck parked. */
export function initialState() {
  return {
    seq: 0,
    now: null,
    clockSet: false,
    replay: false,
    caption: "",
    say: null,
    draft: null,
    quote: null,
    receipt: null,
    agent: { at: "home", carry: null, since: 0 },
    door: { scan: false, stamp: null, reasons: [], since: 0 },
    shelves: Array.from({ length: SHELVES }, emptyShelf),
    phone: { status: "idle", orderId: null, expiresAt: null, cents: null, since: 0 },
    truck: { status: "parked", crates: 0, naive: false, since: 0 },
    naive: { step: null, since: 0 },
    gate: { built: true, since: -60 },
    card: null,
    list: null,
    flash: null,
    rival: null,
    close: false,
    log: [],
    buyer: null,
    offered: {},
    open: [],
    day: [],
    hold: false,
    pallet: { crates: 0, since: 0 },
    rules: false,
    rulesSince: 0,
    mail: null,
    split: null,
    nomilk: false,
    mandates: null,
    warp: null,
    compare: null,
  };
}

/**
 * The time to show at scene time t: during a story time jump (story.warp) the clock runs from the old time to the new one,
 * forward to Monday or backward on the rewind, with an ease in and out; otherwise the state's own time.
 */
export function shownNow(state, t) {
  const w = state.warp;
  if (!w || !(t < w.since + w.dur)) return state.now;
  const u = Math.max(0, (t - w.since) / w.dur);
  const e = u * u * (3 - 2 * u);
  const from = Date.parse(w.from);
  return new Date(from + (Date.parse(w.to) - from) * e).toISOString();
}

/** Crates one accepted order puts on the dock pallet or the truck: a few per order, at least one. */
const cratesFor = (lines) => {
  const units = (Array.isArray(lines) ? lines : []).reduce((sum, l) => sum + (Number(l?.salesUnits) || 0), 0);
  return Math.min(3, Math.max(1, Math.ceil(units / 400)));
};

/**
 * The buyer's day total as the door counts it: accepted and held orders for this delivery day, from the decisions in
 * the event stream. A held order counts until it is accepted, rejected or its approval expires.
 */
export function dayTotal(state) {
  const sum = (status) => state.day.filter((o) => o.status === status).reduce((acc, o) => acc + o.cents, 0);
  return { accepted: sum("accepted"), pending: sum("pending") };
}

/** "Sat 14 Nov 10:15" in Helsinki time. */
export function clockText(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.hour}:${parts.minute}`;
}

/**
 * Live mode's starting scene: the door standing with every kitchen's signed rules in its rack, Hotel Aurora's rule board,
 * and accepted orders waiting on the pallet for delivery day; the scene follows `buyer`, other buyers are "another hotel".
 */
export function liveState(buyer) {
  return { ...initialState(), buyer, hold: true, rules: true, rulesSince: -60, mandates: { since: -60 } };
}

/** Formats integer cents as "1,010.00 €". */
export function euro(cents) {
  return (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/** Time left from now to the cut-off as "43 h 51 min", or "closed" once it has passed. */
export function countdown(nowIso, cutoffIso = CUTOFF) {
  if (!nowIso) return "";
  const left = Date.parse(cutoffIso) - Date.parse(nowIso);
  if (!(left > 0)) return "closed";
  const minutes = Math.floor(left / 60000);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** Reason codes arrive as strings or as { code }; keep only the codes. */
const codesOf = (reasons) => (Array.isArray(reasons) ? reasons.map((r) => (typeof r === "string" ? r : r?.code)).filter(Boolean) : []);

/** One short ticker line per event. */
export function summary(ev) {
  const d = ev.data || {};
  switch (ev.type) {
    case "draft.created": return `“${String(d.text ?? "").slice(0, 60)}”`;
    case "search.done": return `${d.count ?? "?"} candidates`;
    case "valio.called": return `${d.endpoint ?? "valio"}${Number.isFinite(d.ids) ? ` · ${d.ids} ids` : ""}${d.replay ? " · replay" : ""}`;
    case "quote.created": return `${d.offers?.length ?? 0} offer, ${d.rejections?.length ?? 0} rejected`;
    case "policy.decided": return [d.outcome, ...codesOf(d.reasons)].filter(Boolean).join(" · ");
    case "approval.requested": return `phone · until ${String(d.expiresAt ?? "").slice(0, 16)}`;
    case "order.accepted": return Number.isFinite(d.netCents) ? euro(d.netCents) : "accepted";
    case "stock.denied": return `${d.productId} · ${d.remaining} left`;
    case "clock.set": return clockText(d.now) || String(d.now ?? "");
    default: return "";
  }
}

/**
 * One plain-English line per gateway event, for Live's caption, in the words Story uses; null for small steps that only
 * the ticker shows. `other` marks another buyer's event at the same door.
 */
export function plain(ev, other = false) {
  const d = ev.data || {};
  const codes = codesOf(d.reasons);
  if (other) {
    if (ev.type === "search.done") return "Another hotel's agent at the same door, with its own rules.";
    if (ev.type === "policy.decided") return d.outcome === "REJECT" ? `Another hotel: refused, ${codes.join(", ") || "no reason given"}.` : `Another hotel: ${d.outcome === "AUTO" ? "accepted" : "held for its own approver"}.`;
    if (ev.type === "stock.denied") return `Another hotel's agent is told: only ${d.remaining} left.`;
    return null;
  }
  const offer = d.offers?.[0];
  const refused = d.rejections?.length ?? 0;
  switch (ev.type) {
    case "clock.set": return d.now ? `The door's clock: ${clockText(d.now)}.` : null;
    case "draft.created":
      if (d.crossCheck?.result === "disagreed") return "Gemini and Gemma read it differently: the door asks, never guesses.";
      if (d.unclear?.length) return `The door needs more before it orders: ${d.unclear.join(", ")}.`;
      return "The door reads the agent's request as a typed request.";
    case "search.done": return `${d.count} candidates in Valio's catalogue: Valio is asked about these only.`;
    case "quote.created":
      if (!offer) return `No offer: ${refused} refused, each with a reason code.`;
      return `Best offer: ${Number.isFinite(offer.netCents) ? euro(offer.netCents) : "priced"}, fixed.${refused ? ` ${refused} refused, each with a reason code.` : ""}`;
    case "policy.decided":
      if (d.outcome === "AUTO") return "Inside the kitchen's limits: accepted, no human needed.";
      if (d.outcome === "NEEDS_APPROVAL") return "Over the kitchen's own limit: the door holds it.";
      return `Refused by the door: ${codes.join(", ") || "no reason given"}.`;
    case "approval.requested": return "Lazydoor sends the request to the kitchen manager. Not Valio. Not the agent.";
    case "approval.approved": return "The kitchen manager approves on the phone.";
    case "approval.rejected": return "The kitchen manager says no.";
    case "approval.expired": return "Approved too late: expired, nothing ships.";
    case "order.accepted": return `Accepted${Number.isFinite(d.netCents) ? `: ${euro(d.netCents)}` : ""}. On the pallet for delivery day.`;
    case "stock.denied": return `Only ${d.remaining} left of ${d.productId}.`;
    default: return null;
  }
}

/** The log entry an event leaves for the ticker (text) and Live's caption (plain). */
const logEntry = (ev, other = false) => ({ seq: ev.seq ?? null, type: ev.type, text: other ? `another hotel · ${summary(ev)}` : summary(ev), plain: plain(ev, other) });

/** Puts product rows on the shelf slots in order; the last slot counts any overflow in `more`. */
function shelvesFor(rows, t = 0) {
  const shelves = Array.from({ length: SHELVES }, emptyShelf);
  rows.slice(0, SHELVES).forEach((row, i) => Object.assign(shelves[i], row, { since: t }));
  if (rows.length > SHELVES) shelves[SHELVES - 1].more = rows.length - SHELVES;
  return shelves;
}

/** Status a rejection code puts on its shelf. */
function shelfStatus(code) {
  if (code === "CUTOFF_PASSED" || code === "NOT_ORDERABLE" || code === "SALES_BLOCKED") return "locked";
  if (code === "STOCK_LIMITED" || code === "SHORTFALL") return "limited";
  if (CROSSING.has(code)) return "crossed";
  return "locked";
}

/** The day-total entry an order event refers to: by its id, else the newest held order not yet tied to an id. */
const orderEntry = (s, id) => s.day.find((o) => id && o.orderId === id) ?? s.day.findLast((o) => o.status === "pending" && !o.orderId);

/**
 * Another buyer's event (a second hotel's agent at the same door): it only shows in the ticker, as a red flash when the
 * door refuses that buyer, and on the shelf when it learns the stock left. Our own state stays untouched.
 */
function rivalEvent(s, ev, d, t) {
  if ((ev.type === "search.done" || ev.type === "quote.created") && !(s.rival && t - s.rival.since < 6)) s.rival = { since: t, outcome: null, reasons: [] };
  if (ev.type === "policy.decided" && d.outcome === "REJECT") {
    s.rival = { ...s.rival, since: s.rival?.since ?? t, outcome: d.outcome, reasons: codesOf(d.reasons) };
    s.flash = { tone: "reject", since: t };
  }
  if (ev.type === "stock.denied") return false;
  return true;
}

/** Applies one event at scene time t. Returns the same object for a duplicate seq, a new one otherwise. */
export function reduce(state, ev, t) {
  if (!ev || typeof ev.type !== "string") return state;
  if (typeof ev.seq === "number" && ev.seq <= state.seq) return state;
  const s = structuredClone(state);
  const d = ev.data && typeof ev.data === "object" ? ev.data : {};
  if (typeof ev.seq === "number") s.seq = ev.seq;
  if (ev.ts && !s.clockSet) s.now = ev.ts;
  const goAgent = (at, carry = s.agent.carry) => (s.agent = { at, carry, since: t });
  const buyer = ev.buyerId && ev.buyerId !== "admin" && !ev.type.startsWith("story.") ? ev.buyerId : null;
  if (buyer && !s.buyer) s.buyer = buyer;
  if (buyer && buyer !== s.buyer && rivalEvent(s, ev, d, t)) {
    s.log = [...s.log, logEntry(ev, true)].slice(-LOG_KEEP);
    return s;
  }

  switch (ev.type) {
    case "draft.created": {
      const asks = (d.unclear ?? []).length > 0 || d.crossCheck?.result === "disagreed";
      s.draft = { text: d.text ?? "", category: d.category ?? null, claims: d.claims ?? [], quantity: d.quantity ?? null, packLitres: d.packLitres ?? null, deliverBy: d.deliverBy ?? null, unclear: d.unclear?.length ? d.unclear : d.crossCheck?.fields ?? [], asks };
      s.quote = null;
      s.door = { scan: false, stamp: null, reasons: [], since: t };
      s.shelves = shelvesFor([]);
      goAgent("chef", asks ? "question" : "draft");
      break;
    }
    case "draft.confirmed":
      goAgent("door", "draft");
      break;
    case "search.done":
    case "valio.called":
      if (ev.type === "valio.called") s.replay = d.replay === true;
      // Calls that re-check an order (approval, placing it) carry no draft: the robot stays where it is.
      if (ev.draftId === undefined && ev.orderId) break;
      if (s.agent.at !== "door") goAgent("door", "draft");
      s.door = { ...s.door, scan: true, since: t };
      break;
    case "quote.created": {
      const offers = Array.isArray(d.offers) ? d.offers : [];
      const rejections = Array.isArray(d.rejections) ? d.rejections : [];
      s.quote = { offers, rejections, at: t };
      const rows = rejections.filter((r) => r?.productId).map((r) => ({ productId: String(r.productId), status: shelfStatus(r.code), remaining: r.remaining ?? r.limit ?? null, code: r.code ?? null }));
      for (const line of offers[0]?.lines ?? []) if (line?.productId && !rows.some((r) => r.productId === String(line.productId))) rows.push({ productId: String(line.productId), status: "ok", remaining: null, code: null });
      s.shelves = shelvesFor(rows, t);
      s.door = { ...s.door, scan: false, since: t };
      s.agent.carry = "quote";
      if (Number.isFinite(offers[0]?.netCents)) {
        s.offered = { ...s.offered, [ev.quoteId ?? `q${ev.seq}`]: offers[0].netCents };
        s.open = [...s.open, ev.quoteId ?? `q${ev.seq}`];
      }
      break;
    }
    case "policy.decided": {
      if (!OUTCOMES.has(d.outcome)) break;
      s.door = { scan: false, stamp: d.outcome, reasons: codesOf(d.reasons), since: t };
      goAgent("home", d.outcome === "REJECT" ? "rejected" : s.agent.carry);
      // A basket order names no quote: it is every quote offered since the last decision.
      const cents = ev.quoteId && s.offered[ev.quoteId] !== undefined ? s.offered[ev.quoteId] : s.open.reduce((sum, q) => sum + (s.offered[q] ?? 0), 0);
      if (d.outcome !== "REJECT" && cents > 0) s.day = [...s.day, { orderId: ev.orderId ?? null, cents, status: d.outcome === "AUTO" ? "accepted" : "pending", reasons: s.door.reasons, since: t }];
      s.open = [];
      break;
    }
    case "approval.requested": {
      s.phone = { status: "buzzing", orderId: d.orderId ?? ev.orderId ?? null, expiresAt: d.expiresAt ?? null, cents: d.netCents ?? s.quote?.offers?.[0]?.netCents ?? null, since: t };
      const entry = orderEntry(s, s.phone.orderId);
      if (entry) entry.orderId = s.phone.orderId;
      s.mail = { kind: "lazydoor", from: "gate", to: "phone", since: t };
      break;
    }
    case "approval.approved": {
      s.phone = { ...s.phone, status: "approved", since: t };
      const entry = orderEntry(s, ev.orderId ?? s.phone.orderId);
      if (entry) Object.assign(entry, { status: "accepted", since: t });
      if (entry?.reasons && s.door.stamp !== "NEEDS_APPROVAL") s.door = { scan: false, stamp: "NEEDS_APPROVAL", reasons: entry.reasons, since: t };
      s.mail = { kind: "approved", from: "phone", to: "gate", since: t };
      break;
    }
    case "approval.rejected":
    case "approval.expired": {
      s.phone = { ...s.phone, status: ev.type === "approval.rejected" ? "rejected" : "expired", since: t };
      if (ev.type === "approval.rejected") goAgent("home", "rejected");
      const id = ev.orderId ?? s.phone.orderId;
      const entry = s.day.find((o) => o.orderId === id);
      if (entry?.reasons && s.door.stamp !== "NEEDS_APPROVAL") s.door = { scan: false, stamp: "NEEDS_APPROVAL", reasons: entry.reasons, since: t };
      s.day = s.day.filter((o) => !(o.status === "pending" && o.orderId === id));
      break;
    }
    case "order.accepted": {
      const entry = orderEntry(s, ev.orderId);
      if (entry) Object.assign(entry, { status: "accepted", cents: Number.isFinite(d.netCents) ? d.netCents : entry.cents });
      if (s.hold) {
        const added = Math.min(4 - s.pallet.crates, cratesFor(d.lines));
        s.pallet = { crates: s.pallet.crates + added, added, since: t, day: d.lines?.[0]?.deliveryDate ?? s.pallet.day ?? DELIVERY_DAY };
      }
      else {
        const units = (Array.isArray(d.lines) ? d.lines : []).reduce((sum, l) => sum + (Number(l?.salesUnits) || 0), 0);
        s.truck = { status: "loading", crates: Math.min(8, Math.max(1, Math.ceil(units / 125))), naive: false, since: t };
      }
      s.receipt = { orderId: ev.orderId ?? d.orderId ?? null, netCents: Number.isFinite(d.netCents) ? d.netCents : null, grossCents: Number.isFinite(d.grossCents) ? d.grossCents : null, approvedBy: d.approvedBy ?? null, summary: d.summary ?? null, lines: Array.isArray(d.lines) ? d.lines : [] };
      if (!s.hold) goAgent("home", "receipt");
      break;
    }
    case "stock.denied": {
      const id = String(d.productId ?? "");
      let shelf = s.shelves.find((x) => x.productId === id) ?? s.shelves.find((x) => !x.productId) ?? s.shelves[SHELVES - 1];
      Object.assign(shelf, { productId: id, status: "limited", remaining: d.remaining ?? null, code: "STOCK_LIMITED", since: t });
      break;
    }
    case "clock.set":
    case "story.clock":
      if (d.now) Object.assign(s, { now: d.now, clockSet: true });
      // The door's clock reaching delivery day sends the waiting pallet out (Live; Story ships with story.ship).
      if (ev.type === "clock.set" && s.hold && s.pallet.crates && Date.parse(d.now) >= Date.parse(`${s.pallet.day ?? DELIVERY_DAY}T06:00:00+02:00`)) {
        s.truck = { status: "loading", crates: s.pallet.crates, naive: false, since: t, fromPallet: true };
        s.pallet = { crates: 0, since: t };
      }
      break;
    case "story.hold":
      s.hold = true;
      break;
    case "story.ship":
      s.truck = { status: "loading", crates: Math.max(1, s.pallet.crates), naive: false, since: t, fromPallet: true };
      s.pallet = { crates: 0, since: t };
      break;
    case "story.rules":
      s.rules = d.on !== false;
      s.rulesSince = t;
      break;
    case "story.mail":
      s.mail = d.kind ? { kind: d.kind, from: d.from, to: d.to, since: t } : null;
      break;
    case "story.warp":
      if (!d.to) break;
      s.warp = { from: s.now ?? d.to, to: d.to, since: t, dur: d.dur ?? 1, back: Date.parse(d.to) < Date.parse(s.now ?? d.to) };
      Object.assign(s, { now: d.to, clockSet: true });
      break;
    case "story.compare":
      s.compare = { since: t };
      break;
    case "story.nomilk":
      s.nomilk = d.on !== false;
      break;
    case "story.mandates":
      s.mandates = { since: t };
      break;
    case "story.split":
      s.split = d.step ? { step: d.step, cents: d.cents ?? [], since: t } : null;
      break;
    case "story.receipt":
      s.receipt = { ...s.receipt, title: d.title, lines: d.lines };
      break;
    case "story.caption":
      s.caption = d.text ?? "";
      break;
    case "story.say":
      s.say = d.text ? { who: d.who ?? "chef", text: d.text, since: t } : null;
      break;
    case "story.gate":
      s.gate = { built: d.built !== false, since: t };
      break;
    case "story.naive":
      s.naive = { step: d.step ?? null, since: t };
      if (d.step === "take") goAgent("chef", "draft");
      if (d.step === "enter") goAgent("door", "draft");
      if (d.step === "gone") goAgent("home", null);
      if (d.step === "load") s.truck = { status: "loading", crates: 3, naive: true, since: t };
      if (d.step === "stuck") s.truck = { ...s.truck, status: "stuck", since: t };
      if (d.step === "gone") s.truck = { status: "parked", crates: 0, naive: false, since: t };
      break;
    case "story.reset": {
      const fresh = initialState();
      Object.assign(s, { draft: null, quote: null, door: fresh.door, shelves: fresh.shelves, naive: fresh.naive, card: null, list: null, flash: null, rival: null, mail: null, split: null, nomilk: false });
      if (d.truck) s.truck = fresh.truck;
      if (d.phone) s.phone = fresh.phone;
      if (d.agent) s.agent = { ...fresh.agent, since: t };
      break;
    }
    case "story.card":
      s.card = d.title || d.lines?.length ? d : null;
      break;
    case "story.list":
      s.list = d.rows?.length ? d : null;
      break;
    case "story.agent":
      goAgent(d.at ?? "home", d.carry ?? null);
      break;
    case "story.flash":
      s.flash = { tone: d.tone ?? "reject", since: t };
      break;
    case "story.rival":
      s.rival = { since: t, outcome: null, reasons: [] };
      break;
    case "story.close":
      s.close = true;
      break;
  }
  if (!ev.type.startsWith("story.")) s.log = [...s.log, logEntry(ev, Boolean(buyer && s.buyer && buyer !== s.buyer))].slice(-LOG_KEEP);
  return s;
}
