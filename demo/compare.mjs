// Lazydoor's strengths by comparison, one source for the Story's closing "Without the door / With Lazydoor" scene and the
// Compare page. Every "with" line was measured on the door; `evidence` names the acceptance case, reason code or endpoint.

/** The eight strengths the Story closes on, in its order. */
export const STRENGTHS = [
  { topic: "Cut-off", group: "data", without: "Orders after Thursday's cut-off: no milk on Monday", with: "Checks Valio's cut-off before it quotes", evidence: ["AC05", "CUTOFF_PASSED"] },
  { topic: "Spending", group: "money", without: "1,565.50 € spent, nobody asked", with: "Kitchen's own limits; the manager approves above them", evidence: ["scenario 1", "signed mandate"] },
  { topic: "Self-approval", group: "money", without: "The agent could approve itself", with: "Agents can't approve: 403", evidence: ["AC29", "AGENT_CANNOT_APPROVE"] },
  { topic: "Splitting", group: "money", without: "Split orders slip under any limit", with: "The day total is counted", evidence: ["AC30", "OVER_DAY_AUTO"] },
  { topic: "Allergens", group: "safety", without: "Takes a substitute that adds gluten", with: "Refuses a new allergen", evidence: ["AC17", "NEW_ALLERGEN"] },
  { topic: "Stock", group: "safety", without: "Two agents both 'buy' the last boxes", with: "First come, first served; the other is told 2 left", evidence: ["AC31", "STOCK_TAKEN"] },
  { topic: "Meaning", group: "safety", without: "Guesses which Friday", with: "Two models read it; if they disagree, it asks", evidence: ["Gemini and Gemma", "crossCheck"] },
  { topic: "Price", group: "data", without: "Price can move before anyone approves", with: "Fixed price for 30 min, receipt in plain words", evidence: ["AC04", "/v1/orders/{id}/receipt"] },
];

/** Rows only the Compare page shows, after the eight strengths. */
export const PAGE_ONLY = [
  { topic: "Who checks the cut-off", group: "data", without: "Nobody: the agent reads 999999 and orders", with: "The door, on every quote", evidence: ["closingTime", "CUTOFF_PASSED"] },
  { topic: "Quotes", group: "data", without: "Price can change in transit", with: "Signed quote and receipt; check them against the published key", evidence: ["AC51", "QUOTE_SIGNATURE_INVALID", "/.well-known/jwks.json"] },
  { topic: "Audit trail", group: "open", without: "Only what the agent itself logs", with: "Every step hash-chained; verify it yourself", evidence: ["/v1/audit/verify", "/v1/events"] },
  { topic: "Works with any agent", group: "open", without: "Each agent wires Valio's API itself", with: "HTTP and MCP from one schema", evidence: ["/openapi.json", "/mcp (9 tools)"] },
  { topic: "Published rules", group: "open", without: "Rules live inside each agent", with: "Every decision is a published rule with a reason code", evidence: ["/v1/rules", "/v1/reason-codes"] },
];

/**
 * Rows for the door's newer ways in, each shown only while the door advertises its feature (features.mjs). "No
 * equivalent" where neither the webshop nor a direct API call offers one.
 */
export const FEATURE_ROWS = [
  { topic: "Bring your own AI", group: "ways", feature: "connector", without: "Each agent wires Valio's API itself", with: "One URL in Claude; your kitchen's limits still apply", evidence: ["AC66", "OAuth 2.1", "/mcp"] },
  { topic: "Orders your systems can read", group: "ways", feature: "peppol", without: "No equivalent", with: "Peppol BIS Order 3.0 export", evidence: ["AC64", "/v1/orders/{id}/peppol"] },
  { topic: "Speak the order", group: "ways", feature: "voice", without: "No equivalent", with: "Say it; the same two readers and rules apply", evidence: ["AC65", "/v1/try/voice"] },
];

/** The Compare page's groups, in order; a group shows only when it has rows. */
export const GROUPS = [
  { id: "data", heading: "Valio's data, read right" },
  { id: "money", heading: "The kitchen's money" },
  { id: "safety", heading: "Safety and fair play" },
  { id: "open", heading: "Open to check" },
  { id: "ways", heading: "Use it your way" },
];

/** The sentence under the Compare page's title, in place of a webshop column we could only fill with guesses. */
export const COMPARE_NOTE = "A person ordering in the webshop catches what they notice. An agent calling Valio's API directly catches only what it was built to check.";

/** The closing line under the Story's comparison. */
export const CONNECT_LINE = "Any agent connects: HTTP API · /openapi.json   MCP · /mcp (9 tools)";
