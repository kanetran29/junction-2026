## The problem
Kitchens are starting to let AI agents order for them. Valio Aimo's API answers availability and price, not whether an order makes sense. An agent that reads it literally gets it wrong:
- `availableAmount 999999` means "stock unknown", not "999,999 in stock".
- `closingTime` is the cut-off: the 10-litre milk box for Monday closed on Thursday 15:00, yet still shows Monday.
- Nobody is asked before 1,565.50 € is spent, so on Monday morning there is no milk.

This is not rare. In Valio's recorded replies for 539 products, 58% of stock figures are 999999, 13% have no delivery line and 40% are past their cut-off yet still show a delivery date. 29 of Valio's 250 substitute pairs add a new allergen; 46% of the 17,546 products declare no allergen info.

## What we built
**Lazydoor: lazy at the order, strict at the border.** One door at Valio for every buyer's agent. The agent may send plain words; the door checks every order against Valio's rules and each kitchen's signed rules, and never guesses.

1. **Request.** Gemini turns the sentence into a typed request; Gemma 4 reads it again on its own. If they disagree ("for Friday": 13 or 20 Nov?), the door asks.
2. **Lookup.** The door searches the catalogue and asks Valio only about the candidates (35 lactose-free milks), in at most two calls.
3. **Quote at a fixed price.** Offers are ranked by net price and the price is held for 30 minutes. Every refusal carries a reason code: `CUTOFF_PASSED`, `STOCK_LIMITED`, `NEW_ALLERGEN`.
4. **Decision.** The kitchen's signed mandate sets what the agent may do alone (e.g. 500 € an order, 1,500 € a day). Above that, the order is held and Lazydoor asks the kitchen manager, never Valio or the agent. Hard limits are refused.

## Guardrails we show working
- The agent cannot approve its own order (403).
- Splitting an order to dodge approval fails: the day total counts.
- A Valio substitute that adds gluten to a gluten-free product is refused.
- Two agents racing for the last 6 boxes: the first wins, the other is told 2 are left.
- An approval after Valio's cut-off expires; nothing ships.
- An agent can cancel its own order until Valio's cut-off (stock and day total freed, signed record); after it, `ORDER_CUTOFF_PASSED`.

## Every step is checkable
- Every step is an event in a **hash-chained log** on Aiven PostgreSQL.
- `GET /v1/audit/verify` recomputes the chain and signs the result (Ed25519); `scripts/verify-audit.mjs` checks it without trusting the door.
- **Quotes and receipts are signed** (EdDSA, key at `/.well-known/jwks.json`); a changed price fails with `QUOTE_SIGNATURE_INVALID`.

## Proof
- Deployed at https://lazydoor.lazydoor.workers.dev on Valio's recorded replies.
- 69/69 acceptance cases and 11/11 scenarios pass on the deployed door; 458 unit and integration tests pass.
- On 14 test sentences, Lazydoor's reader (Gemini 3.8 Flash) got 96 of 98 fields right and asked the buyer whenever it and a second model, Gemma 4, disagreed (3 sentences), which caught both of its mistakes, though 14 sentences is a small sample. No model decides prices, limits, stock or approval.
- A real Gemini agent on the deployed door: milk held, approved by the manager, accepted at 1,010.00 €; a 154.00 € chicken order accepted with no human.

## Try it yourself
Demo page: https://lazydoor.lazydoor.workers.dev/demo/
- **Story:** one kitchen from Friday to Monday.
- **Live:** the scene animates the door's real event log. In **Try it**, type or **say** a request as the chef and, if it is held, decide as the kitchen manager (your own sandbox kitchen).
- **From Claude:** add `https://lazydoor.lazydoor.workers.dev/mcp` as a custom connector. OAuth gives you your own kitchen with the same limits; Claude orders, only you approve.
- **Compare**, **Inside** and **Deck**.

## Open to any agent
- One schema serves a typed HTTP API (`/openapi.json`) and an MCP server (`/mcp`, 10 tools; API key or OAuth 2.1 with PKCE).
- Discovery: `/.well-known/agent-gateway.json`, an RFC 9727 API catalog (`/.well-known/api-catalog`) and `/llms.txt`.
- Rules at `/v1/rules`, 42 reason codes at `/v1/reason-codes`.
- Accepted orders export as **Peppol BIS Order 3.0** (UBL 2.1) for kitchens' ordering systems.
- A reference Gemini agent holds only an agent key, verifies each quote signature and never sees an approval link.

## Built with
- Cloudflare Workers, Hono, TypeScript; D1 for the read-only catalogue.
- **Aiven for PostgreSQL** holds every write (orders, stock ledger, approvals, mandates, event log) via Cloudflare Hyperdrive. Each order commits in one transaction under an advisory lock.
- **Gemini** reads requests and runs the reference agent; **Gemma 4** is the second reader.

## Path to production
Ordering is simulated: Valio's API has no order endpoint. To go live, Valio adds one with its allocation rule; the door, rules and agents stay.

Code (MIT): https://github.com/kanetran29/junction-2026
