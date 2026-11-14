// The Inside tab: the one page a judge reads to see the whole project. Every fact here is in the repo (README,
// src/domain/reasons.ts, research/acceptance/cases.json); the live checks read the door itself when the tab opens.

export const DOOR_URL = "https://lazydoor.lazydoor.workers.dev";
export const REPO_URL = "https://github.com/kanetran29/junction-2026";

/** Section 1: what it is. */
export const WHAT = {
  punchline: "Lazy at the order, strict at the border.",
  lines: [
    "Lazydoor is one door at Valio for every buyer's agent: it applies Valio's rules plus each kitchen's own signed rules.",
    "The agent may be lazy. The door is strict and never guesses: when it is not sure, it asks the human.",
  ],
};

/** Section 2: how an order flows, one step per box. */
export const FLOW = [
  { step: "Words", text: "A kitchen's agent sends a sentence or a typed order." },
  { step: "Typed request", text: "Gemini drafts it, Gemma 4 reads it again; if they disagree, the door asks the human." },
  { step: "Search", text: "17,546 products; Valio is asked only about the candidates, in at most 2 calls." },
  { step: "Quote", text: "A fixed price for 30 minutes or until the cut-off, signed by the door." },
  { step: "Policy", text: "Valio's rules plus the kitchen's signed mandate." },
  { step: "Decision", text: "AUTO; or HELD, and the manager approves through their own link; or REJECT with a reason code." },
  { step: "Receipt", text: "A signed receipt in plain words." },
];
export const FLOW_NOTE = "Every step is an event in a hash-chained log.";

/** Section 3: guardrails, each with its code and the acceptance case (or test) that proves it on the door. */
export const GUARDRAILS = [
  { what: "Ordering after Valio's cut-off", code: "CUTOFF_PASSED", proof: "AC05" },
  { what: "Valio's 999999 means stock unknown, not unlimited", code: "stockNote on the quote line", proof: "README · seller rule orderable" },
  { what: "The kitchen's limits, per order and per day", code: "OVER_ORDER_AUTO · OVER_DAY_AUTO", proof: "AC01 · AC30" },
  { what: "The agent cannot approve its own order", code: "403 AGENT_CANNOT_APPROVE", proof: "AC29" },
  { what: "An approval after the cut-off expires", code: "APPROVAL_EXPIRED", proof: "AC20" },
  { what: "A substitute that adds an allergen is refused", code: "NEW_ALLERGEN", proof: "AC17" },
  { what: "Two agents race for the last boxes: one winner", code: "STOCK_TAKEN", proof: "AC31 · 20 concurrent orders, exactly 1 accepted" },
  { what: "The price moved while the order was held", code: "PRICE_CHANGED", proof: "AC35" },
  { what: "Two readings disagree, so the door asks", code: "needs_input", proof: "AC44" },
  { what: "Above the hard limit, even with approval", code: "OVER_ORDER_HARD", proof: "AC16" },
  { what: "A tampered quote is refused", code: "422 QUOTE_SIGNATURE_INVALID", proof: "AC51" },
];

/** Section 6: what each part of the stack does. */
export const BUILT_WITH = [
  { part: "Aiven for PostgreSQL", does: "Every write: one transaction per order under an advisory lock, and the hash-chained event log." },
  { part: "Cloudflare Workers + Hyperdrive", does: "The door itself, with pooled connections to Postgres." },
  { part: "Cloudflare D1", does: "The read-only catalogue: 17,546 products and the recorded Valio replies." },
  { part: "Gemini 3.8 Flash", does: "Drafts the typed request and powers the reference agent." },
  { part: "Gemma 4 31B", does: "The second, independent reader of every request." },
  { part: "OpenAPI + MCP", does: "One schema: an HTTP API and an MCP server with 9 tools." },
];

/** Section 7: the path to production. */
export const PRODUCTION = "Valio adds an order endpoint and its allocation rule.";

/** Section 4: the endpoints the tab reads live, in order. */
export const CHECKS = [
  { id: "audit", path: "/v1/audit/verify", title: "Audit chain" },
  { id: "jwks", path: "/.well-known/jwks.json", title: "Signing key" },
  { id: "discovery", path: "/.well-known/agent-gateway.json", title: "Discovery document" },
  { id: "rules", path: "/v1/rules", title: "Published rules" },
  { id: "codes", path: "/v1/reason-codes", title: "Reason codes" },
];

/** The one-line commands a judge can copy. */
export const COMMANDS = [
  `node scripts/verify-audit.mjs ${DOOR_URL}`,
  `curl -s ${DOOR_URL}/v1/audit/verify`,
];

/**
 * Turns one live check's HTTP result into what the tab shows: { state, text }, state "ok", "bad", "pending" or "down".
 * A route the deployed door does not answer yet (404, or 401 while it is still behind a key) is "pending", never an error.
 */
export function summarize(id, status, body) {
  if (status === 0) return { state: "down", text: "Not reachable from this page." };
  if (status === 404 || status === 401) return { state: "pending", text: "Coming with the next deploy." };
  if (status !== 200 || !body || typeof body !== "object") return { state: "down", text: `The door answered HTTP ${status}.` };
  switch (id) {
    case "audit":
      return body.valid
        ? { state: "ok", text: `Chain valid ✓ · ${body.count} events · head ${String(body.headHash).slice(0, 12)}` }
        : { state: "bad", text: `Chain broken at event ${body.firstBadSeq ?? "?"} ✕ · ${body.count} events` };
    case "jwks": {
      const key = body.keys?.[0];
      return key ? { state: "ok", text: `Key id ${key.kid} · ${key.alg ?? ""} ${key.crv ?? ""}`.trim() } : { state: "down", text: "No key published." };
    }
    case "discovery": {
      const urls = [body.openapi, body.mcp?.url, body.rules, body.reasonCodes, body.events?.poll, body.events?.stream, body.audit?.verify, body.jwks].filter(Boolean);
      return { state: "ok", text: `${urls.length} endpoints`, list: urls };
    }
    case "rules": {
      const decisions = body.decisions ?? [];
      const owners = {};
      for (const d of decisions) owners[d.owner] = (owners[d.owner] ?? 0) + 1;
      return { state: "ok", text: `${decisions.length} rules · ${Object.entries(owners).map(([owner, n]) => `${n} ${owner}`).join(", ")}` };
    }
    case "codes":
      return { state: "ok", text: `${(body.codes ?? []).length} reason codes, each with its text and resolution` };
    default:
      return { state: "ok", text: "OK" };
  }
}

/** Runs one live check against the door at `base`; never throws. */
export async function runCheck(base, check, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${String(base).replace(/\/+$/, "")}${check.path}`, { headers: { Accept: "application/json" } });
    const body = res.ok ? await res.json().catch(() => null) : null;
    return summarize(check.id, res.status, body);
  } catch {
    return summarize(check.id, 0, null);
  }
}
