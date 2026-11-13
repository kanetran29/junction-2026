# Trusted Trade Gateway – design

Junction 2026, Valio Aimo challenge "Trusted Trade Agents". Agreed in conversation with Kane on Fri 13 Nov 2026 (solo build; scope is
decided on merit, not on hours). Evidence for every data claim: local-only repo `~/junction26-valio` (`NOTES.md`, `ANALYSIS.md`);
challenge data is never committed here.

## Intent

The brief: *"Build the prototype that lets an AI purchasing agent buy food from a wholesaler: safely, openly, and with the right human
approval."* The flow the solution must run: **Request** (agent asks for what the buyer needs) → **Lookup** → **Order** (commit at a
fixed price) → **Approval** (agent decides, or a human signs off). Example: a hotel chain's agent asks for 1,000 l of lactose-free milk
by Monday; the solution returns products, prices and availability in structured form; the agent orders within its authority or sends it
to a human.

So the prototype has two equal parts:
- **Purchasing agent** (buyer side, Gemini): understands the need, searches, compares offers, chooses within its authority, asks a
  human when it must, handles exceptions. This is where *autonomy* is shown.
- **Trusted trade gateway** (Valio side, no model in its decisions): structured lookup, quotes, the mandate and its enforcement,
  approval, receipts, on open interfaces. This is where *controls* and *openness* are shown.

Judging (poster): working end-to-end demo 30 · solving the user's need 20 · autonomy and controls 20 · robustness to exceptions 15 ·
openness and path to production 15. Poster rules: "It is not a chatbot." "Query the APIs only when needed, never for all products."
"Not a production-ready system in 48 hours."

## Goals

- Core 1, lookup: the agent finds a product type by attributes and gets facts with units it can compute on; Valio is asked only about a shortlist.
- Core 2, request to order: a quantity in litres or kg becomes whole sales units; price, validity and cut-off are frozen in a quote; the order repeats the quote.
- Core 3, permissions and approval: a signed buyer mandate the agent cannot edit; outcomes AUTO / NEEDS_APPROVAL / REJECT with reason codes; a human approves exactly what will be placed, before the order cut-off.
- Autonomy: the agent compares feasible offers on price, delivery, reliability and labels, chooses one, and explains why; the gateway checks the choice.
- Bonus: delivery reliability and sustainability labels per offer, carbon as a category-level value, safe substitutions when the exact request cannot be met, a human-readable record of what happened and why.
- Accept requests as plain text (the brief's own example is a sentence) without becoming a chatbot.

## Non-goals

A buyer-side chat UI; a real order API (simulated, said so on screen); payments; requests in pieces for products sold by kg; production
auth, tenancy or scale; uploading the video or publishing anything.

## Anti-goals

- A language model deciding whether an order is allowed, or able to widen the agent's authority.
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
| A. Smart gateway | The gateway plans and picks for the agent | Rejected: takes autonomy away from the agent, which the rubric scores |
| **B. Quote protocol + autonomous agent** | Gateway: `interpret` → `search` → `quote` (all feasible offers, ranked, plus typed rejections) → `place_order`; the agent chooses; policy decides on the order | **Picked** |
| C. Conversational concierge | A model inside the gateway talks to the agent | Ruled out: "It is not a chatbot", decisions cannot be replayed |

## Design

Principle: **the model proposes, rules decide.** The agent (a model) proposes needs and choices; the gateway's rules decide what is allowed.

### Gateway (Valio side)
1. **Catalogue index** (offline script → D1): id, names fi/en/sv, category, sales/base units, lot size, temperature class, claims,
   allergens (contains / may contain / free from), labels (organic, MSC, Finnish origin…), brand, origin, reliability, carbon, official
   substitutes; Gemini-assisted category names and subtypes, hand-checked for the demo families. Loaded from `~/junction26-valio/data`.
2. **`interpret(text)` → draft**: Gemini turns a sentence into a typed draft (type, claims, quantity + unit, deliver-by, brand rule
   `only` or `prefer`, pack preference) plus `unclear` fields. Rules validate it against the schema and the catalogue. The buyer's
   agent fills the `unclear` fields and confirms with `confirm_draft` (no human step). Policy never reads free text.
3. **`search_products(draft | filters)`** → candidates from the index; zero Valio calls.
4. **`quote(candidates, quantity, deliverBy, preferences)`** → calls Valio price and availability for the shortlist only; normalises
   sentinels, cut-offs, units, VAT; returns **every feasible offer** (a single product, or a split across products when stock is limited)
   ranked by price per litre/kg, each with fill, overage, totals, reliability, labels, carbon; and every rejected product with a reason
   code (CUTOFF_PASSED, STOCK_LIMITED n, NOT_ORDERABLE, NOT_CONVERTIBLE, SUBTYPE_MISMATCH, CLAIM_MISSING, BRAND_EXCLUDED…). A brand
   `only` rule is a hard filter; `prefer` only ranks. If no offer covers the quantity, the best partial offer is marked SHORTFALL.
   A quote is immutable and expires at the earliest of cut-off, price `validTo`, 30 minutes.
5. **Mandate**: per buyer, versioned, a JWS (EdDSA) signed with the **buyer's** key; the gateway stores the buyer's public key and verifies
   it. Seeded by a script for the demo (`mandate:sign`); changing it means signing a new version. Fields, each with an auto limit and a
   hard limit: per-order net amount (auto 500 €, hard 5,000 €) and per-delivery-day net amount counting pending orders (auto 1,500 €,
   hard 10,000 €); required claims; no new allergen; reliability floor 0.9; approver.
6. **Policy** on `place_order(quoteId, offerId)`: checks that the chosen offer belongs to the quote; three-valued facts (pass / fail /
   unknown). Above an auto limit → NEEDS_APPROVAL (so split orders cannot dodge approval); above a hard limit → REJECT; missing required
   claim or a new allergen → REJECT; pack size change, substitute, SHORTFALL, reliability unknown or below the floor → NEEDS_APPROVAL.
   Every outcome carries reason codes.
7. **Order states**: `place_order` is idempotent (a retry returns the same receipt). An AUTO order is accepted at once. A NEEDS_APPROVAL
   order is held until the cut-off (the quote's 30 minutes stop applying once it is held); approval re-checks price and orderability,
   then accepts. Status "accepted by gateway (simulated)".
8. **Approval page** (phone): bound to a hash of the exact lines, single use, expires at the cut-off; shows the diff against the request,
   the agent's reason for its choice, totals net and gross, a countdown, Approve / Reject.
9. **Receipt and log**: plain-language receipt written from reason codes (templates, no model), event log of every step.
10. **Interfaces**: one schema → OpenAPI (HTTP) and MCP tools; reason-code catalogue; README with "what is simulated" and "what Valio must add".
11. **Clock and replay**: the gateway clock can be set; recorded Valio replies can be replayed, shown with a "replay" badge; replay is the
    default after Sun 15 Nov 17:00 so the demo keeps working.
12. **Access**: deployed on workers.dev; every call needs an agent API key (buyer + agent identity); a separate judge key on request;
    `interpret` is rate-limited per key; the catalogue is only served as query results, never as a bulk download.

### Purchasing agent (buyer side)
13. A Gemini agent with the gateway's tools (MCP or HTTP). It turns the buyer's words into a request, fills `unclear` fields from what
    it knows about the buyer, compares the quote's offers, chooses within the mandate it holds, and writes a short reason for the choice
    (shown to the approver). On REJECT or SHORTFALL it adjusts (another offer, a split, asking the human) instead of giving up. Its tool
    calls and reasons are shown live in the demo. Any other MCP client or `curl` can replace it, which shows the door is open.

### Demo scenarios
(1) the brief's example; (2) the same with "bulk 10 l packs" → CUTOFF_PASSED, the agent picks 1 l cartons and asks approval for the
pack change; "Arla only" → STOCK_LIMITED, SHORTFALL or split; (3) chicken breast by kg with 4.4 kg steps and variable weight.
Guardrail attacks: split orders exceed the daily auto limit → NEEDS_APPROVAL; "1000" of a case product is rejected as 20,000 l;
an allergen-adding substitute is REJECTED; approval after the cut-off expires; a repeated order returns the same receipt.

Stack: Cloudflare Workers (TypeScript) + D1 on the dedicated hackathon Cloudflare account; Gemini API for `interpret`, catalogue
tagging and the purchasing agent. Code in this public MIT repo; Valio data, keys and the Valio API key stay outside it.

## Calls made by Claude (check these)

Limits have auto and hard values (500 / 5,000 € per order, 1,500 / 10,000 € per day); split orders go to approval, not rejection;
the agent, not a human, confirms `interpret` drafts; the buyer signs the mandate, the gateway verifies; brand `only` is hard, `prefer`
ranks; a shortfall needs approval; a held order lives until the cut-off; deployed with per-agent keys and a judge key.

## Left to the builder

Module layout, D1 schema details, exact reason-code names beyond those above, page styling, test framework, template wording.
