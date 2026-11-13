# Trusted Trade Gateway – design

Junction 2026, Valio Aimo challenge "Trusted Trade Agents". Approved in conversation with Kane on Fri 13 Nov 2026.
Evidence for every data claim: local-only repo `~/junction26-valio` (`NOTES.md`, `ANALYSIS.md`); challenge data is never committed here.

## Intent

Valio Aimo wants the interface and operating model that lets an **external** AI purchasing agent buy from it: find products, get
prices and availability in structured form, order at fixed prices, within the agent's authority or after a human signs off, on open,
verifiable standards. We build that door on Valio's side. The buyer's agent is someone else's; we ship a thin sample agent only to run
the demo end to end.

Judging (poster): working end-to-end demo 30 · solving the user's need 20 · autonomy and controls 20 · robustness to exceptions 15 ·
openness and path to production 15. Poster rules: "It is not a chatbot." "Query the APIs only when needed, never for all products."
"Not a production-ready system in 48 hours."

## Goals

- Core 1, lookup: an agent finds a product type by attributes and gets facts with units it can compute on; Valio is asked only about a shortlist.
- Core 2, request to order: a quantity in litres or kg becomes whole sales units; price, validity and cut-off are frozen in a quote; the order repeats the quote.
- Core 3, permissions and approval: a buyer mandate the agent cannot edit; outcomes AUTO / NEEDS_APPROVAL / REJECT with reason codes; a human approves exactly what will be placed, before the order cut-off.
- Bonus: delivery reliability and sustainability labels per offer, carbon as a category-level value, safe substitutions when the exact request cannot be met, a human-readable record of what happened and why.
- Accept requests as plain text (the brief's own example is a sentence) without becoming a chatbot.

## Non-goals

A buyer-side product or chat UI; a real order API (simulated, said so on screen); payments; requests in pieces for products sold by kg;
production auth, tenancy or scale; uploading the video or publishing anything.

## Anti-goals

- A language model deciding anything about an order, or able to widen the agent's authority.
- Selling what cannot arrive: a product past its cut-off, an unlimited-stock sentinel read as a quantity, a wrong unit.
- A substitute that adds an allergen or drops a required claim without a human seeing it.
- Committing Valio data to this public repo.

## Constraints from the data and the mock API

- Mock = frozen snapshot of delivery Mon 16 Nov 2026; `requestedDate` is ignored, `availableDate` must be compared with the date asked.
- "Orderable" = has a schedule line, `closingTime > now`, amount > 0, no sales block, unit understood. Stock products close Sun 15 Nov 17:00;
  Terminal products closed Thu 12 Nov yet still report 999999 for Monday. After Sun 17:00 nothing in the mock is orderable.
- `availableAmount` 999999, 9999999999 and 1e10 / units-per-case mean "not limited".
- Content per sales unit = `catalogPrice / comparisonPrice` from the price API, snapped to Synkka or name value when within 2 %, else NOT_CONVERTIBLE.
- `allowedLotSize` 0.01 means no rule: round up to whole sales units and show the overage; respect real steps (e.g. 4.4 kg).
- Unknown product: HTTP 200 with empty lines and `error: true`. Max 1,000 ids per call. The firewall rejects the default Python user agent.
- Product type = category code AND claims (`nutritionalClaim FREE_FROM_LACTOSE` etc.) AND temperature class; names are a fallback only.
- Official substitutions: 1.1 % of products, some add allergens or lose claims → hints, never applied without our checks.
- Reliability covers 25 %, carbon is a product-group average: show both with "unknown" and coverage, never rank within a type by carbon.

## Approaches considered

| Approach | What it is | Verdict |
|---|---|---|
| A. Smart gateway | The gateway plans several options, substitutes and splits on its own | Rejected: plans are near-copies on the happy path; "find an option" is what the brief asks |
| **B. Quote protocol** | `interpret` → `search` → `quote` → `order`; a quote is an immutable, expiring object with offers and typed rejections; policy decides on the order | **Picked** |
| C. Conversational concierge | A model inside the gateway talks to the agent | Ruled out: "It is not a chatbot", decisions cannot be replayed |

## Design (decided)

Principle: **the model proposes, rules decide.** No model in the decision path of the gateway.

1. **Catalogue index** (offline script → D1): id, names fi/en/sv, category, sales/base units, lot size, temperature class, claims,
   allergens (contains / may contain / free from), labels (organic, MSC, Finnish origin…), brand, origin, reliability, carbon, official
   substitutes; Gemini-assisted category names and subtypes, hand-checked for the demo families. Loaded from `~/junction26-valio/data`.
2. **`interpret(text)`** → draft: Gemini turns a sentence into a typed draft (type, claims, quantity + unit, deliver-by, preferences) plus
   `unclear` fields. Rules validate it against the schema and the catalogue. Only a confirmed draft continues. Policy never reads free text.
3. **`search_products(draft | filters)`** → candidates from the index; zero Valio calls.
4. **`quote(candidates, quantity, deliverBy, preferences)`** → calls Valio price and availability for the shortlist only; normalises
   sentinels, cut-offs, units, VAT; picks one recommended fill (one product, or a split when stock is limited); lists every rejected
   offer with a reason code (CUTOFF_PASSED, STOCK_LIMITED n, NOT_ORDERABLE, NOT_CONVERTIBLE, SUBTYPE_MISMATCH, CLAIM_MISSING…);
   expires at the earliest of cut-off, price `validTo`, 30 minutes. Immutable.
5. **Mandate + policy**: per buyer, stored server-side, versioned and signed (JWS, EdDSA) so Valio and the buyer can verify it.
   Fields: per-order and per-delivery-day limits (net), required claims, no-new-allergen rule, what needs approval (pack size change,
   substitute, reliability unknown or below floor), approver. Facts are three-valued (pass / fail / unknown); unknown on a required
   rule → approval. Outcome AUTO / NEEDS_APPROVAL / REJECT with reason codes. Cumulative spend counts pending orders.
6. **Safe substitution**: only when the exact request cannot be met; same claims, no new allergen, same temperature class, price inside
   the mandate; official pairs as hints; always needs approval.
7. **Order**: `place_order(quoteId)` only; idempotent (a retry returns the same receipt); re-checks price and orderability at placing;
   status "accepted by gateway (simulated)".
8. **Approval**: phone page bound to a hash of the exact lines, single use, expires at the cut-off; shows the diff against the request,
   totals net and gross, a countdown, Approve / Reject.
9. **Receipt and log**: plain-language receipt written from reason codes (templates, no model), event log of every step.
10. **Interfaces**: one schema → OpenAPI (HTTP) and MCP tools; reason-code catalogue; README with "what is simulated" and "what Valio must add".
11. **Clock and replay**: the gateway clock can be set; recorded Valio replies can be replayed, shown with a "replay" badge, so the demo
    still works after Sun 17:00.
12. **Sample buyer agent**: thin Gemini script calling the tools; the same door works from any MCP client or `curl`.

Demo scenarios: (1) the brief's example; (2) the same with "bulk 10 l packs" → CUTOFF_PASSED and 1 l cartons, and "Arla only" →
STOCK_LIMITED and a split or shortfall; (3) chicken breast by kg with 4.4 kg steps and variable weight. Plus the guardrail attacks:
split orders hit the daily cap, "1000" of a case product is rejected as 20,000 l, an allergen-adding substitute is rejected, approval
after the cut-off expires, a repeated order returns the same receipt.

Stack: Cloudflare Workers (TypeScript) + D1 on the dedicated hackathon Cloudflare account; Gemini API for `interpret`, catalogue
tagging and the sample agent. Code in this public MIT repo; Valio data and the API key stay outside it.

## Left to the builder

Module layout, D1 schema details, exact reason-code names beyond those above, page styling, test framework, template wording.
