// Pure scene model: gateway events (docs/events.md schema) and story cues in, scene state out.

export const SHELVES = 4;
export const CUTOFF = "2026-11-15T17:00:00+02:00";
const LOG_KEEP = 9;
const OUTCOMES = new Set(["AUTO", "NEEDS_APPROVAL", "REJECT"]);
const CROSSING = new Set(["NEW_ALLERGEN", "SUBTYPE_MISMATCH", "CLAIM_MISSING", "TEMP_CLASS_CHANGED", "UNIT_MISMATCH", "BRAND_EXCLUDED"]);

/** Empty shelf slot; productId null means nothing is shown on its tag. */
const emptyShelf = () => ({ productId: null, status: "idle", remaining: null, code: null, more: 0, since: 0 });

/** The scene before any event: agent docked by the chef, the door standing and idle, truck parked. */
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
    close: false,
    log: [],
  };
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
    case "valio.called": return `${d.endpoint ?? "valio"}${d.replay ? " · replay" : ""}`;
    case "quote.created": return `${d.offers?.length ?? 0} offer, ${d.rejections?.length ?? 0} rejected`;
    case "policy.decided": return [d.outcome, ...codesOf(d.reasons)].filter(Boolean).join(" · ");
    case "approval.requested": return `phone · until ${String(d.expiresAt ?? "").slice(0, 16)}`;
    case "order.accepted": return Number.isFinite(d.netCents) ? euro(d.netCents) : "accepted";
    case "stock.denied": return `${d.productId} · ${d.remaining} left`;
    case "clock.set": return String(d.now ?? "");
    default: return "";
  }
}

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

/** Applies one event at scene time t. Returns the same object for a duplicate seq, a new one otherwise. */
export function reduce(state, ev, t) {
  if (!ev || typeof ev.type !== "string") return state;
  if (typeof ev.seq === "number" && ev.seq <= state.seq) return state;
  const s = structuredClone(state);
  const d = ev.data && typeof ev.data === "object" ? ev.data : {};
  if (typeof ev.seq === "number") s.seq = ev.seq;
  if (ev.ts && !s.clockSet) s.now = ev.ts;
  const goAgent = (at, carry = s.agent.carry) => (s.agent = { at, carry, since: t });

  switch (ev.type) {
    case "draft.created":
      s.draft = { text: d.text ?? "", category: d.category ?? null, claims: d.claims ?? [], quantity: d.quantity ?? null, unclear: d.unclear ?? [] };
      s.quote = null;
      s.door = { scan: false, stamp: null, reasons: [], since: t };
      s.shelves = shelvesFor([]);
      goAgent("chef", s.draft.unclear.length ? "question" : "draft");
      break;
    case "draft.confirmed":
      goAgent("door", "draft");
      break;
    case "search.done":
    case "valio.called":
      if (s.agent.at !== "door") goAgent("door", "draft");
      s.door = { ...s.door, scan: true, since: t };
      if (ev.type === "valio.called") s.replay = d.replay === true;
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
      break;
    }
    case "policy.decided":
      if (!OUTCOMES.has(d.outcome)) break;
      s.door = { scan: false, stamp: d.outcome, reasons: codesOf(d.reasons), since: t };
      if (d.outcome === "REJECT") goAgent("chef", "rejected");
      break;
    case "approval.requested":
      s.phone = { status: "buzzing", orderId: d.orderId ?? ev.orderId ?? null, expiresAt: d.expiresAt ?? null, cents: d.netCents ?? s.quote?.offers?.[0]?.netCents ?? null, since: t };
      break;
    case "approval.approved":
      s.phone = { ...s.phone, status: "approved", since: t };
      break;
    case "approval.rejected":
      s.phone = { ...s.phone, status: "rejected", since: t };
      goAgent("chef", "rejected");
      break;
    case "approval.expired":
      s.phone = { ...s.phone, status: "expired", since: t };
      break;
    case "order.accepted": {
      const units = (Array.isArray(d.lines) ? d.lines : []).reduce((sum, l) => sum + (Number(l?.salesUnits) || 0), 0);
      s.truck = { status: "loading", crates: Math.min(8, Math.max(1, Math.ceil(units / 125))), naive: false, since: t };
      s.receipt = { orderId: ev.orderId ?? d.orderId ?? null, netCents: Number.isFinite(d.netCents) ? d.netCents : null };
      goAgent("truck", "receipt");
      break;
    }
    case "stock.denied": {
      const id = String(d.productId ?? "");
      let shelf = s.shelves.find((x) => x.productId === id) ?? s.shelves.find((x) => !x.productId) ?? s.shelves[SHELVES - 1];
      Object.assign(shelf, { productId: id, status: "limited", remaining: d.remaining ?? null, code: "STOCK_LIMITED", since: t });
      break;
    }
    case "clock.set":
      if (d.now) Object.assign(s, { now: d.now, clockSet: true });
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
      Object.assign(s, { draft: null, quote: null, door: fresh.door, shelves: fresh.shelves, truck: fresh.truck });
      if (d.phone) s.phone = fresh.phone;
      if (d.agent) s.agent = { ...fresh.agent, since: t };
      break;
    }
    case "story.close":
      s.close = true;
      break;
  }
  if (!ev.type.startsWith("story.")) s.log = [...s.log, { seq: ev.seq ?? null, type: ev.type, text: summary(ev) }].slice(-LOG_KEEP);
  return s;
}
