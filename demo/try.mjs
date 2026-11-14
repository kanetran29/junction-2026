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

/**
 * What the panel shows for one reply of /v1/try or /v1/try/decision (or an error), as a view model:
 * { kind, tone, title, lines, choices?, actions? }. kind "hide" means the door has no sandbox (not a demo door). `byManager`
 * marks a /v1/try/decision reply, where REJECTED is the manager's own decision.
 */
export function viewOf({ status, body, retryAfter }, codes = {}, byManager = false) {
  if (status === 404) return { kind: "hide" };
  if (status === 429) return { kind: "error", tone: "hold", title: `Busy: try again in ${retryAfter ?? body?.retryAfter ?? 30} s`, lines: [] };
  if (status === 400) return { kind: "error", tone: "reject", title: "Type a request of 1 to 200 characters.", lines: body?.detail ? [String(body.detail)] : [] };
  if (status === 0) return { kind: "error", tone: "reject", title: "The door is not answering. Try again in a moment.", lines: [] };
  if (status !== 200 || !body) return { kind: "error", tone: "reject", title: `The door answered HTTP ${status}.`, lines: [] };

  if (body.step === "needs_input" && body.question) {
    const q = body.question;
    const date = q.field === "deliverBy";
    const read = (v) => (date ? dayLabel(v) : String(v));
    const readings = q.readings ?? [];
    return {
      kind: "question",
      tone: "hold",
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
