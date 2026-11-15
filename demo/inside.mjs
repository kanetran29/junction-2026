// The Inside tab: the one page a judge reads to see the whole project. Every fact here is in the repo (README,
// src/domain/reasons.ts, research/acceptance/cases.json); the live checks read the door itself when the tab opens.

export const DOOR_URL = "https://lazydoor.lazydoor.workers.dev";
export const REPO_URL = "https://github.com/kanetran29/junction-2026";
export const PITCH_VIDEO_URL = "https://youtu.be/etiVUAh1mYw";

/** The hero: the punchline, one sentence of at most 20 words, and the still beside it. */
export const HERO = {
  punchline: "Lazy at the order, strict at the border.",
  sentence: "One door at Valio for every kitchen's agent: Valio's rules plus each kitchen's own signed rules, and it never guesses.",
  still: { src: "assets/stills/held.webp", alt: "The isometric scene: the door holds a 1,010.00 € milk order and the kitchen manager's phone rings for approval." },
};

/** How an order flows: one verb per node, one line of detail under it. */
export const FLOW = [
  { verb: "Ask", detail: "A kitchen's agent sends a sentence or a typed order." },
  { verb: "Read", detail: "Gemini drafts it and Gemma 4 reads it again. If they disagree, the door asks." },
  { verb: "Search", detail: "17,546 products. Valio is asked about the candidates only, in at most 2 calls." },
  { verb: "Quote", detail: "A fixed price for 30 minutes or until the cut-off, signed." },
  { verb: "Check", detail: "Valio's rules plus the kitchen's signed mandate." },
  { verb: "Decide", detail: "Accept, hold for the manager's own approval link, or refuse with a reason code." },
  { verb: "Sign", detail: "A signed receipt in plain words." },
];
export const FLOW_NOTE = "Every step is an event in a hash-chained log.";
export const FLOW_STILL = { src: "assets/stills/refusals.webp", alt: "The door refuses the 10 l milk boxes and lists each refusal with its reason code.", caption: "The 10 l boxes are refused: their cut-off passed on Thursday. Each refusal names its reason code." };

/** Guardrails in three clusters; each item is one sentence with its codes and its proof as separate chips. */
export const GUARDRAILS = [
  {
    heading: "Valio's data, read right",
    items: [
      { text: "An order after Valio's cut-off is refused.", codes: ["CUTOFF_PASSED"], proof: ["AC05"] },
      { text: "Valio's 999999 means stock unknown, and the quote says so.", codes: ["stockNote"], proof: ["rule: orderable"] },
      { text: "A price that moved while the order was held is not approved silently.", codes: ["PRICE_CHANGED"], proof: ["AC35"] },
    ],
  },
  {
    heading: "The kitchen's limits",
    items: [
      { text: "Orders over the kitchen's limit per order or per day wait for the manager.", codes: ["OVER_ORDER_AUTO", "OVER_DAY_AUTO"], proof: ["AC01", "AC30"] },
      { text: "Above the hard limit, an order is refused even with approval.", codes: ["OVER_ORDER_HARD"], proof: ["AC16"] },
      { text: "The agent cannot approve its own order.", codes: ["403 AGENT_CANNOT_APPROVE"], proof: ["AC29"] },
      { text: "An approval after the cut-off expires and places nothing.", codes: ["APPROVAL_EXPIRED"], proof: ["AC20"] },
    ],
  },
  {
    heading: "Safety and honesty",
    items: [
      { text: "A substitute that adds an allergen is refused.", codes: ["NEW_ALLERGEN"], proof: ["AC17"] },
      { text: "When two agents race for the last boxes, exactly one wins.", codes: ["STOCK_TAKEN"], proof: ["AC31", "20-order race test"] },
      { text: "When the two readings disagree, the door asks instead of guessing.", codes: ["needs_input"], proof: ["AC44"] },
      { text: "A tampered quote is refused.", codes: ["422 QUOTE_SIGNATURE_INVALID"], proof: ["AC51"] },
    ],
  },
];
export const GUARD_STILL = { src: "assets/stills/nomilk.webp", alt: "Without the door: Monday morning, the kitchen calendar is stamped NO MILK.", caption: "Without the door, the agent ordered boxes past their cut-off. Monday had no milk." };

/**
 * What each part of the stack does, in three groups. `marks` are its logos in assets/logos (see NOTICE.md): `icon` is a
 * Simple Icons file the page tints to its text colour, `image` an official logo shown exactly as its owner serves it.
 */
export const BUILT_WITH = [
  {
    group: "Data",
    parts: [
      { name: "Aiven for PostgreSQL", marks: [{ image: "aiven-logo-white.svg" }], line: "Every write: one transaction per order under an advisory lock, and the hash-chained event log." },
      { name: "Cloudflare D1", marks: [{ icon: "cloudflare" }], line: "The read-only catalogue of 17,546 products and the recorded Valio replies." },
    ],
  },
  {
    group: "Models",
    parts: [
      { name: "Gemini 3.8 Flash", marks: [{ icon: "googlegemini" }], line: "Drafts the typed request and runs the reference agent." },
      { name: "Gemma 4 31B", marks: [{ image: "gemma-mark-dark.svg" }], line: "Reads every request a second time, on its own." },
    ],
  },
  {
    group: "Runtime and interfaces",
    parts: [
      { name: "Cloudflare Workers and Hyperdrive", marks: [{ icon: "cloudflare" }], line: "Run the door and pool its connections to Postgres." },
      { name: "OpenAPI and MCP", marks: [{ icon: "openapiinitiative" }, { icon: "modelcontextprotocol" }], line: "One schema for an HTTP API and an MCP server with 10 tools." },
    ],
  },
];

/** The path to production, with the still of Monday's delivery. */
export const PRODUCTION = {
  sentence: "Valio adds an order endpoint and its allocation rule.",
  still: { src: "assets/stills/delivery.webp", alt: "Monday: the truck unloads the milk and chicken beside the chef, with the signed receipt." },
};

/** The endpoints the tab reads live; the four tiles show them (rules and reason codes share one tile). */
export const CHECKS = [
  { id: "audit", path: "/v1/audit/verify", title: "Audit chain" },
  { id: "jwks", path: "/.well-known/jwks.json", title: "Signing key" },
  { id: "discovery", path: "/.well-known/agent-gateway.json", title: "Discovery" },
  { id: "rules", path: "/v1/rules", title: "Published rules" },
  { id: "codes", path: "/v1/reason-codes", title: "Reason codes" },
];

/** The one-line commands a judge can copy. */
export const COMMANDS = [
  `node scripts/verify-audit.mjs ${DOOR_URL}`,
  `curl -s ${DOOR_URL}/v1/audit/verify`,
];

/**
 * Turns one live check's HTTP result into what its tile shows: { state, value, text, list? }, state "ok", "bad",
 * "pending" or "down". A route the deployed door does not answer yet (404, or 401 while it is still behind a key) is
 * "pending", never an error.
 */
export function summarize(id, status, body) {
  if (status === 0) return { state: "down", value: "Not reachable", text: "Not reachable from this page." };
  if (status === 404 || status === 401) return { state: "pending", value: "Next deploy", text: "Coming with the next deploy." };
  if (status !== 200 || !body || typeof body !== "object") return { state: "down", value: `HTTP ${status}`, text: `The door answered HTTP ${status}.` };
  switch (id) {
    case "audit":
      return body.valid
        ? { state: "ok", value: "Chain valid", text: `${body.count} events, head ${String(body.headHash).slice(0, 12)}` }
        : { state: "bad", value: "Chain broken", text: `At event ${body.firstBadSeq ?? "?"} of ${body.count}` };
    case "jwks": {
      const key = body.keys?.[0];
      return key ? { state: "ok", value: `${key.alg ?? "EdDSA"} ${key.crv ?? ""}`.trim(), text: `Key id ${String(key.kid).slice(0, 12)}` } : { state: "down", value: "No key", text: "No key published." };
    }
    case "discovery": {
      const urls = [body.openapi, body.mcp?.url, body.rules, body.reasonCodes, body.events?.poll, body.events?.stream, body.audit?.verify, body.jwks].filter(Boolean);
      return { state: "ok", value: `${urls.length} endpoints`, text: "Everything an agent needs to find the door.", list: urls };
    }
    case "rules": {
      const decisions = body.decisions ?? [];
      const owners = {};
      for (const d of decisions) owners[d.owner] = (owners[d.owner] ?? 0) + 1;
      return { state: "ok", value: `${decisions.length} rules`, text: Object.entries(owners).map(([owner, n]) => `${n} ${owner}`).join(", ") };
    }
    case "codes":
      return { state: "ok", value: `${(body.codes ?? []).length} codes`, text: "Each with its sentence and how to resolve it." };
    default:
      return { state: "ok", value: "OK", text: "" };
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
