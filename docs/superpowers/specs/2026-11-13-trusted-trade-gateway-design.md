# Lazydoor – design

*Lazy at the order, strict at the border.*

Junction 2026, Valio Aimo challenge "Trusted Trade Agents". Agreed in conversation with Kane on Fri 13 Nov 2026 (solo build; scope is
decided on merit, not on hours). Evidence for every data claim: `research/NOTES.md`, `research/ANALYSIS.md`; acceptance cases in
`research/acceptance/`. The Valio dataset itself is never committed: `research/fetch_data.sh` downloads it into gitignored `.data/valio/`.

## Intent

The brief: *"Build the prototype that lets an AI purchasing agent buy food from a wholesaler: safely, openly, and with the right human
approval."* The flow the solution must run: **Request** (agent asks for what the buyer needs) → **Lookup** → **Order** (commit at a
fixed price) → **Approval** (agent decides, or a human signs off). Example: a hotel chain's agent asks for 1,000 l of lactose-free milk
by Monday; the solution returns products, prices and availability in structured form; the agent orders within its authority or sends it
to a human.

So the prototype has two equal parts:
- **Purchasing agent** (buyer side, Gemini): understands the need, searches, compares offers, chooses within its authority, asks a
  human when it must, handles exceptions. This is where *autonomy* is shown.
- **Lazydoor**, the trusted trade gateway (Valio side; called "the gateway" or "the door" below; decides by published rules, each with a named owner; models translate and tag, and no model
  output is a decision): structured lookup, quotes, the mandate and its enforcement, approval, receipts, on open interfaces. This is
  where *controls* and *openness* are shown.

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
auth, tenancy or scale; uploading the video or publishing anything; reserving stock for quotes or held orders; suggestion templates;
correcting misspelt input; SD-JWT / AP2 key binding.

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

Principle: **the gateway decides by published rules, each with a named owner; models translate and tag, and no model output is a
decision.** The agent (a model) proposes needs and choices; the gateway's rules decide what is allowed. A model sits in three places on
Valio's side (offline catalogue tagger, optional `interpret`, optional term expansion for occasion search) and all three only translate
or tag; the register of decisions is served at `GET /v1/rules`.

### Gateway (Valio side)
1. **Catalogue index** (offline script → D1): id, names fi/en/sv, category, sales/base units, lot size, temperature class, claims,
   allergens (contains / may contain / free from), labels (organic, MSC, Finnish origin…), brand (normalised once at build time: trim,
   case, punctuation), origin, reliability, carbon, official substitutes, sales-unit GTIN, and a search text (marketing + usage text,
   lowercased, with the product's own names and brand removed); Gemini-assisted category names and subtypes, hand-checked for the demo
   families and marked `tagSource: reviewed` (else `model`). Loaded from `.data/valio/data`.
2. **`interpret(text)` → draft**: Gemini turns a sentence into a typed draft (type, claims, quantity + unit, deliver-by, brand rule
   `only` or `prefer`, pack preference) plus `unclear` fields. Rules validate it against the schema and the catalogue. The buyer's
   agent fills the `unclear` fields and confirms with `confirm_draft` (no human step). Policy never reads free text. A request with no
   product type ("a party on Monday, buy what we need") gives `draft.status = "needs_input"` with `missing[]` listing every missing
   field at once; the gateway never invents a need or a quantity.
   **`GET /v1/families`** (optional `terms`): every family with category, name, subtypes, claims that exist in it, productCount and
   `tagSource`. With `terms`, families are ranked by evidence `{terms, mentions, of}` over the search text (min 3 mentions; mentions
   descending, then mentions / of); no products, no quantities, zero Valio calls.
3. **`search_products(draft | filters)`** → candidates from the index; zero Valio calls.
4. **`quote(candidates, quantity, deliverBy, preferences)`** → calls Valio price and availability for the shortlist only; normalises
   sentinels, cut-offs, units, VAT; returns **every feasible offer** (a single product, or a split across products when stock is limited)
   ranked by `rankedBy: ["netTotal", "unitPrice", "reliability"]`, each with fill, overage, totals, reliability, labels, carbon; and every
   rejected product with a reason code (CUTOFF_PASSED, STOCK_LIMITED n, NOT_ORDERABLE, NOT_CONVERTIBLE, SUBTYPE_MISMATCH, CLAIM_MISSING,
   BRAND_EXCLUDED, UPSTREAM_ERROR…). A brand `only` rule is a hard filter; `prefer` only ranks. If no offer covers the quantity, the best
   partial offer is marked SHORTFALL. The quote also carries `summary {candidates, offered, rejected, unaccounted}` (unaccounted is
   always 0) and `understoodAs` (the confirmed draft). Each candidate gets the first failing code in this published precedence:
   PRICE_UNAVAILABLE, NOT_ORDERABLE, SALES_BLOCKED, CUTOFF_PASSED, DATE_NOT_MET, then CLAIM_MISSING, BRAND_EXCLUDED, SUBTYPE_MISMATCH,
   NOT_CONVERTIBLE, STOCK_LIMITED. Available stock = Valio amount − accepted lines for that product and delivery day (section 7).
   A quote is immutable, reserves nothing, and expires at the earliest of cut-off, price `validTo`, 30 minutes.
5. **Mandate**: per buyer, versioned, a JWS (EdDSA) signed with the **buyer's** key; the gateway stores the buyer's public key and verifies
   it. Seeded by a script for the demo (`mandate:sign`); changing it means signing a new version. Fields, each with an auto limit and a
   hard limit: per-order net amount (auto 500 €, hard 5,000 €) and per-delivery-day net amount counting accepted and held orders (auto
   500 €, hard 10,000 €; D1); required claims; no new allergen; reliability floor 0.9; `reliabilityUnknown: allow | approve` (default
   `allow`: RELIABILITY_UNKNOWN becomes a flag on the offer, not an approval reason; D4); approver; `exp` and `aud` (the gateway).
6. **Policy** on `place_order` runs on N selected offers (a basket of one or more); limits compare the basket net total. It checks that
   each chosen offer belongs to its quote; three-valued facts (pass / fail / unknown). Above an auto limit → NEEDS_APPROVAL (so split
   orders cannot dodge approval); above a hard limit → REJECT; missing required claim or a new allergen → REJECT; mandate past `exp` →
   REJECT MANDATE_EXPIRED; pack size change, substitute, SHORTFALL, PARTIAL_BASKET, SUBTYPE_UNVERIFIED, reliability below the floor (or
   unknown when the mandate says `approve`) → NEEDS_APPROVAL; stock gone at commit → REJECT STOCK_TAKEN. Every outcome carries reason codes.
7. **Order states**: `place_order` is idempotent (a retry returns the same receipt). Only ACCEPTED orders take stock; a quote and a HELD
   order reserve nothing (D2). Commit (an AUTO place or a successful approval) is **one SQL statement** that inserts all lines only if
   every finite line still fits against (Valio amount read at commit − accepted lines for that product and delivery day), so a basket is
   all-or-nothing and there is no check-then-insert gap. The loser gets state REJECTED, reason STOCK_TAKEN, `available`, `retryable:
   false`, `resolution: "requote"`. A NEEDS_APPROVAL order is held until the cut-off (the quote's 30 minutes stop applying once it is
   held). Approval re-check outcomes: stock gone → EXPIRED / STOCK_TAKEN (+ `available`); price differs from the held lines → EXPIRED /
   PRICE_CHANGED; cut-off passed → EXPIRED / APPROVAL_EXPIRED; never a silent change to what the human approved. Status "accepted by
   gateway (simulated)": in this prototype the ledger is a **mock ledger adapter**; in production Valio's order API and allocation rule
   replace it at the same call.
8. **Approval** (D5): `place_order` never returns the approval link or token; it returns `approval {status, approver}`. The link is listed
   only in the approver inbox `GET /approver/{approverKey}` (key seeded with the mandate; shown as a QR code in the demo). The approve
   route rejects agent keys with 403. The token hash covers every line (productId, salesUnits, unit, net cents per unit, taxRate,
   deliveryDate), buyerId and mandate version; single use; expires at the cut-off. The phone page shows the diff against the request,
   the `understoodAs` draft, the agent's reason for its choice, totals net and gross, "not reserved: N available now", a countdown,
   Approve / Reject.
9. **Receipt and log**: plain-language receipt written from reason codes (templates, no model), event log of every step.
10. **Interfaces**: one schema → OpenAPI (HTTP) and MCP tools (each with `outputSchema`; business refusals set `isError`); reason-code
    catalogue `GET /v1/reason-codes` with `resolution` (recoverable | requires_buyer_input | requires_buyer_review) and `retryable` per
    code; `GET /v1/rules`, static JSON built from the constants module: `decisions[] {id, rule, owner: seller|buyer|agent|approver,
    model: bool, constants}` with ids at least orderable, conversion, rounding, subtype, ranking, rejectionPrecedence, split,
    substitution, quoteExpiry, allocation, approvalRecheck, interpretation, policy, approval. `POST /v1/orders` follows the ACP
    idempotency rules: missing `Idempotency-Key` → 400, same key in flight → 409, same key with another body → 422. README with "what is
    simulated", "what Valio must add", a standards map (AP2, ACP, UCP, MCP, Peppol) and "accepted = binding order, invoiced on delivery".
10a. **Baskets**: `POST /v1/baskets {needs: [draft | referenceProduct…]}` → `{basketId, quotes: [Quote], expiresAt = earliest}`: N
    ordinary single-need quotes. `POST /v1/orders` accepts `{quoteId, offerId}` or `{basketId, selections: [{quoteId, offerId}]}`. An
    order is the lines of the selected offers; a single-need order is a basket of one. A need without a selection → PARTIAL_BASKET,
    listed as `order.unmet[]` with its reason. One approval for the whole basket. Gross = Σ over tax rates of round-half-up(net × (1 +
    rate)). Outcomes map to Peppol Order Response: ACCEPTED = AP, REJECTED = RE, a SHORTFALL or substitute line = CA.
10b. **Resolve**: `POST /v1/resolve {productId | gtin | brand | name}` → status RESOLVED | TYPE_RESOLVED | AMBIGUOUS | BRAND_NOT_CARRIED |
    NO_MATCH, with `product` or `candidates[]` (each with salesUnit and content) and `didYouMean[]`. Only a sales-unit GTIN resolves (a
    GTIN found only at another packaging level, or shared, is AMBIGUOUS); an exact name on two products is AMBIGUOUS; the gateway never
    corrects input; `didYouMean` = carried brands within edit distance 1 of the normalised input. Brand rule `only` with a brand not
    carried → zero offers and `notes[]` BRAND_NOT_CARRIED; `prefer` → other brands with BRAND_CHANGED on the offer.
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
Guardrail attacks: the brief's order split in three (334 + 333 + 333 l) → the second is NEEDS_APPROVAL; the agent opens the
approval itself → 403; "1000" of a case product is rejected as 20,000 l; an allergen-adding substitute is REJECTED; approval after the
cut-off expires; a repeated order returns the same receipt; two agents, six units → one receipt and one typed STOCK_TAKEN refusal with
what is left.

Stack: Cloudflare Workers (TypeScript) + D1 on the dedicated hackathon Cloudflare account; Gemini API for `interpret`, catalogue
tagging and the purchasing agent. Code in this public MIT repo; Valio data, keys and the Valio API key stay outside it.

## Decisions after REVIEW-2 (accepted by Kane, Sat 14 Nov)

Source: `~/junction26-valio/REVIEW-2.md` section 12 (local only). Every recommendation was accepted.

| | Decision |
|---|---|
| D1 | Per-delivery-day auto limit = 500 € net, cumulative over the buyer's accepted and held orders for that day, so splitting an order cannot dodge approval. |
| D2 | Held orders do not reserve stock. Only accepted orders take stock; the first authorised order wins, in one atomic statement. |
| D3 | A vague request gets a typed form (`needs_input` + `missing[]`), the catalogue map (`/v1/families`) and an occasion evidence search over supplier text. The door never invents a need or a quantity. |
| D4 | Unknown delivery reliability is the buyer's choice in the mandate (`reliabilityUnknown: allow | approve`); the default `allow` only flags the offer. |
| D5 | The approval link goes only to the approver inbox (a QR code on screen in the demo), never back to the agent. |
| D6 | REVIEW-2 section 11 is applied to this spec and to the plan before any code. |

## Calls made by Claude (check these)

Limits have auto and hard values (500 / 5,000 € per order, 500 / 10,000 € per day); split orders go to approval, not rejection;
the agent, not a human, confirms `interpret` drafts; the buyer signs the mandate, the gateway verifies; brand `only` is hard, `prefer`
ranks; a shortfall needs approval; a held order lives until the cut-off; deployed with per-agent keys and a judge key.

## Left to the builder

Module layout, D1 schema details, exact reason-code names beyond those above, page styling, test framework, template wording.
