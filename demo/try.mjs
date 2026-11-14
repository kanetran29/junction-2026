// "Try it" in Live: a visitor types a request as the chef and, when the door holds the order, decides as the kitchen
// manager. This module talks to the door's sandbox routes (POST /v1/try, /v1/try/decision; demo doors only, no key) and
// turns each reply into what the panel shows. No DOM here, so it is tested in Node.
import { euro, clockText } from "./model.mjs";

export const MAX_TEXT = 200;

/** Example requests that fill the input. */
export const EXAMPLES = [
  "1,000 litres of lactose-free milk by Monday",
  "20 kg of chicken breast fillet by Monday",
  "40 kg of chicken breast fillet for Friday, Atria only",
  "50 litres of gluten-free oat drink by Monday",
];

/** POSTs JSON to a try route; never throws: { status, body, retryAfter }, status 0 when the door does not answer. */
export async function postTry(base, path, payload, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${String(base).replace(/\/+$/, "")}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await res.json().catch(() => null);
    const retryAfter = Number(body?.retryAfter ?? res.headers?.get?.("Retry-After")) || null;
    return { status: res.status, body, retryAfter };
  } catch {
    return { status: 0, body: null, retryAfter: null };
  }
}

/** "2026-11-13" as "Fri 13 Nov". */
export const dayLabel = (date) => clockText(`${date}T12:00:00+02:00`).slice(0, 10) || String(date);

/** A reason as "CODE: its sentence", the sentence from /v1/reason-codes when known, else the door's detail. */
const reasonLine = (r, codes) => {
  const code = typeof r === "string" ? r : r?.code;
  const sentence = codes[code] ?? (typeof r === "object" ? r?.detail : null);
  return sentence ? `${code}: ${sentence}` : String(code);
};

/** Net and gross of an order as one line. */
const money = (o) => [Number.isFinite(o?.netCents) ? `Net ${euro(o.netCents)}` : "", Number.isFinite(o?.grossCents) ? `Gross ${euro(o.grossCents)}` : ""].filter(Boolean).join(" · ");

/** The door's question for a field the request left open, in plain words. */
const QUESTIONS = {
  deliverBy: "When should it arrive?",
  quantity: "How much?",
  needs: "Which product?",
  category: "Which product?",
  subtype: "Which product?",
  claims: "Any requirements, such as lactose-free?",
  brand: "Which brand?",
  packLitres: "Which pack size?",
  fatLevel: "Which fat level?",
};
export const questionFor = (field) => QUESTIONS[field] ?? `One more detail: ${field}?`;

/** The line under an answer whose readings were recorded (the example chips are served from recorded readings). */
export const CACHED_NOTE = "Example: readings recorded from Gemini and Gemma";

/**
 * What the panel shows for one reply of /v1/try or /v1/try/decision (or an error), as a view model:
 * { kind, tone, title, lines, choices?, actions?, wait?, examples?, cached? }. kind "hide" means Try it is off on this door
 * (not a demo door, or switched off). `wait` is the seconds Send stays off; `examples` asks the panel to point at the
 * example chips; `cached` marks recorded readings. `byManager` marks a /v1/try/decision reply, where REJECTED is the
 * manager's own decision.
 */
export function viewOf(res, codes = {}, byManager = false) {
  const view = replyView(res, codes, byManager);
  return res.status === 200 && res.body?.draft?.cached === true ? { ...view, cached: true } : view;
}

/** The view for one reply, before the recorded-readings mark. */
function replyView({ status, body, retryAfter }, codes, byManager) {
  if (status === 404) return { kind: "hide" };
  if (status === 429 && body?.error === "TRY_SANDBOXES_FULL") return { kind: "error", tone: "hold", title: "Too many visitors right now, try again in a minute.", lines: [] };
  if (status === 429) {
    const wait = Math.max(1, Math.round(retryAfter ?? body?.retryAfter ?? 30));
    return { kind: "error", tone: "hold", title: `Busy: try again in ${wait} s`, lines: [], wait };
  }
  if (status === 503 && body?.error === "MODELS_BUSY") return { kind: "error", tone: "hold", title: "The models are busy right now. Try one of the examples, they work instantly.", lines: [], examples: true };
  if (status === 400) return { kind: "error", tone: "reject", title: "Type a request of 1 to 200 characters.", lines: body?.detail ? [String(body.detail)] : [] };
  if (status === 0 || status === 502 || status === 503) return { kind: "error", tone: "reject", title: "The door did not answer. Try again.", lines: [] };
  if (status !== 200 || !body) return { kind: "error", tone: "reject", title: `The door answered HTTP ${status}.`, lines: [] };

  if (body.step === "needs_input" && body.question) {
    const q = body.question;
    const date = q.field === "deliverBy";
    const read = (v) => (date ? dayLabel(v) : String(v));
    const readings = q.readings ?? [];
    const draftId = body.draft?.id ?? null;
    if (readings.length < 2) return { kind: "question", tone: "hold", title: questionFor(q.field), lines: [], choices: [], field: q.field, draftId };
    return {
      kind: "question",
      tone: "hold",
      field: q.field,
      draftId,
      title: date ? "Which day? The two readers disagree." : `Which ${q.field}? The two readers disagree.`,
      lines: [readings.map((r) => `${/gemma/i.test(r.model) ? "Gemma" : /gemini/i.test(r.model) ? "Gemini" : r.model} read ${read(r.value)}`).join(", ") + ". The door asks, never guesses."],
      choices: readings.map((r) => ({ label: read(r.value), field: q.field, value: r.value })),
    };
  }
  if (body.step === "no_offer") {
    const counts = {};
    for (const r of body.quote?.rejections ?? []) counts[r.code] = (counts[r.code] ?? 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return { kind: "no_offer", tone: "reject", title: "No offer: every candidate was refused.", lines: top.map(([code, n]) => `${n} × ${reasonLine(code, codes)}`) };
  }
  const order = body.order;
  if (!order) return { kind: "error", tone: "reject", title: "The door sent no order.", lines: [] };
  const reasons = (order.reasons ?? []).map((r) => reasonLine(r, codes));
  switch (order.state) {
    case "ACCEPTED":
      return { kind: "accepted", tone: "auto", title: `Accepted${Number.isFinite(order.netCents) ? `: ${euro(order.netCents)} net` : ""}. On the pallet for delivery day.`, lines: reasons };
    case "HELD":
      return {
        kind: "held",
        tone: "hold",
        title: "You are the kitchen manager",
        lines: [money(order), ...reasons, body.approval?.expiresAt ? `Decide before ${clockText(body.approval.expiresAt)}` : ""].filter(Boolean),
        actions: body.approval?.token ? [{ label: "Approve", decision: "approve" }, { label: "Reject", decision: "reject" }] : [],
        token: body.approval?.token ?? null,
      };
    case "EXPIRED":
      return { kind: "final", tone: "reject", title: "Expired: approved too late, nothing ships.", lines: reasons };
    case "REJECTED":
      if (byManager) return { kind: "rejected", tone: "reject", title: "Rejected by the kitchen manager. Nothing ships.", lines: reasons };
      return { kind: "rejected", tone: "reject", title: "Refused by the door.", lines: reasons.length ? reasons : ["No reason given."] };
    default:
      return { kind: "final", tone: "", title: `Order ${order.state}.`, lines: reasons };
  }
}
