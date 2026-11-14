// Lazydoor's strengths by comparison, one source for the Story's closing "Without the door / With Lazydoor" scene and the
// Compare page. Every "with" line was measured on the door; `evidence` names the acceptance case, reason code or endpoint.
// The webshop column says only what we know: "the person, if they notice" or "—", never a claim about another product.

/** The eight strengths the Story closes on, in its order; the Compare page shows them first. */
export const STRENGTHS = [
  { topic: "Cut-off", without: "Orders after Thursday's cut-off: no milk on Monday", webshop: "the person, if they notice", with: "Checks Valio's cut-off before it quotes", evidence: "AC05 · CUTOFF_PASSED" },
  { topic: "Spending", without: "1,565.50 € spent, nobody asked", webshop: "—", with: "Kitchen's own limits; the manager approves above them", evidence: "scenario 1 · signed mandate" },
  { topic: "Self-approval", without: "The agent could approve itself", webshop: "—", with: "Agents can't approve: 403", evidence: "AC29 · AGENT_CANNOT_APPROVE" },
  { topic: "Splitting", without: "Split orders slip under any limit", webshop: "—", with: "The day total is counted", evidence: "AC30 · OVER_DAY_AUTO" },
  { topic: "Allergens", without: "Takes a substitute that adds gluten", webshop: "the person, if they notice", with: "Refuses a new allergen", evidence: "AC17 · NEW_ALLERGEN" },
  { topic: "Stock", without: "Two agents both 'buy' the last boxes", webshop: "—", with: "First come, first served; the other is told 2 left", evidence: "AC31 · STOCK_TAKEN" },
  { topic: "Meaning", without: "Guesses which Friday", webshop: "—", with: "Two models read it; if they disagree, it asks", evidence: "Gemini + Gemma · crossCheck" },
  { topic: "Price", without: "Price can move before anyone approves", webshop: "—", with: "Fixed price for 30 min, receipt in plain words", evidence: "AC04 · /v1/orders/{id}/receipt" },
];

/** Rows only the Compare page shows, after the eight strengths. */
export const PAGE_ONLY = [
  { topic: "Who checks the cut-off", without: "Nobody: the agent reads 999999 and orders", webshop: "the person, if they notice", with: "The door, on every quote", evidence: "closingTime · CUTOFF_PASSED" },
  { topic: "Audit trail", without: "Only what the agent itself logs", webshop: "—", with: "Every step hash-chained; verify it yourself", evidence: "/v1/audit/verify · /v1/events" },
  { topic: "Quotes", without: "Price can change in transit", webshop: "—", with: "Signed quote and receipt; check against /.well-known/jwks.json", evidence: "AC51 · QUOTE_SIGNATURE_INVALID" },
  { topic: "Works with any agent", without: "Each agent wires Valio's API itself", webshop: "—", with: "HTTP and MCP from one schema", evidence: "/openapi.json · /mcp (9 tools)" },
  { topic: "Published rules", without: "Rules live inside each agent", webshop: "—", with: "Every decision is a published rule with a reason code", evidence: "/v1/rules · /v1/reason-codes" },
];

/** The closing line under the Story's comparison. */
export const CONNECT_LINE = "Any agent connects: HTTP API · /openapi.json   MCP · /mcp (9 tools) · 49 acceptance cases pass.";
