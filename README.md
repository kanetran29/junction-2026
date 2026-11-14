# Lazydoor

**Lazy at the order, strict at the border.**

Lazydoor is a trusted-trade gateway for Valio Aimo, built for Junction 2026 (challenge "Trusted Trade Agents").
A buyer's purchasing agent can order from Valio in plain words. The gateway checks every order against Valio's own rules and the buyer's signed limits. It never guesses.

It has two parts.

- **The door.** A Cloudflare Worker with a typed HTTP API (OpenAPI) and an MCP server. An agent finds products, gets a quote, places an order and reads the receipt. Every refusal has a reason code.
- **The reference agent.** A small purchasing agent, `agent/buyer.ts`. It uses Gemini function calling over the door's MCP tools, holds only an agent key and never sees an approval link. See [agent/README.md](agent/README.md).

## Who decides what

The door decides by published rules. Each rule has a named owner. Models translate and tag. No model output is a decision.

`GET /v1/rules` publishes the register: for each step, the rule, the owner (`seller`, `buyer` or `approver`), whether a model is involved, and the constants behind it. It is built from the code's own constants, so it cannot drift.

- **Seller (Valio) rules:** what is orderable, unit conversion, rounding, subtype match, ranking (by net total, no sponsored placement), the order in which rejections are picked, splits, substitutions, quote expiry (30 minutes or the earliest Valio cut-off), first-come-first-served allocation, and the re-check of a held order.
- **Buyer rules:** the signed mandate. Default: auto-approve up to 500 EUR per order and per day. Hard stop at 5,000 EUR per order and 10,000 EUR per day. No new allergen. Delivery reliability at least 0.9. The limits and the approver are the customer's own rules, carried in the mandate they sign; Valio sets none of them and enforces no approval today, and "only the manager orders" stops working once an agent orders on anyone's behalf. The door applies each customer's rules to every agent, and a human approves agent orders over the customer's limit, which matches what Valio said is needed for now.
- **Stock unknown:** Valio reports availability of 999999 or more for products it does not stock. It means the availability is unknown, and Valio's own logic allows any quantity. Lazydoor does the same and labels the quote line (`stockNote`) and the approval page "Stock unknown: Valio does not stock this product".
- **Approver:** a held order is accepted only when the named human approves it through their own link.
- **The only model step:** turning free text into a typed draft (`interpret_request`). Gemini drafts it and Gemma reads the same sentence a second time on its own (below). Policy and money never read model output directly.

## Aiven PostgreSQL holds every write

The door has two stores. The Valio catalog (17,546 products, their GTINs, category names and the recorded Valio replies) is read-only and stays in Cloudflare D1. Everything the door writes lives in **Aiven for PostgreSQL** (PostgreSQL 18), reached through Cloudflare Hyperdrive, which pools the connections: orders and the stock ledger, approvals and their tokens, signed mandates and buyer keys, drafts, quotes and baskets, the event log, API keys, rate counters and the demo clock. `GET /health` answers `"store": "aiven-postgres"` when the server offers Aiven's `aiven_extras` extension.

What Aiven does for Lazydoor:

- **The stock ledger commits in one transaction.** Placing or approving an order runs one transaction under a transaction-scoped advisory lock (`pg_advisory_xact_lock`). It books the order, re-checks the buyer's day total and inserts the order's lines only if each one still fits Valio's limit less the lines already accepted. Either all of it happens or none of it does. A test races 20 orders of 4 units for a 6-unit product against Postgres: exactly one is accepted, the rest get `STOCK_TAKEN`.
- **The audit log is hash-chained.** Every step appends an event with a strictly increasing sequence number and `hash = sha256(prevHash + canonical JSON of the event)`. A second advisory lock is held from reading the previous hash to the commit, so the chain stays linear under concurrent writes and a reader polling `seq > since` (the SSE stream, the demo page, a judge) never skips an event that commits late or sees a hash change.
- **No row-write quota.** D1's free tier stops at 100,000 row writes a day, and loading the catalog used that up. Aiven bills by plan, not per row, so the demo keeps writing.

## Gemma reads every request a second time

Gemini drafts the order from the buyer's sentence. **Gemma 4** (`gemma-4-31b-it`, on the same Gemini API) reads the same sentence on its own, in parallel, with the same prompt and output schema. Both readings pass the same rules (a known category and claims, a unit of l, kg or pcs, a real date that is not in the past). Lazydoor then compares them field by field, with claims compared as a set and brand names without case.

- **Same reading:** the draft goes on, marked `crossCheck: { result: "agreed" }`.
- **Different reading:** the draft comes back `needs_input`. The field is left out, `missing` names it, and `disagreement` shows what each model read. The buyer fills it in `confirm_draft`. The door never picks one reading. For example, "We need 40 kg of chicken breast fillet for Friday, Atria only", sent on Friday 13 Nov: Gemini read 13 Nov, Gemma read 20 Nov, so the buyer is asked which Friday.
- **No answer from Gemma** within 20 s, or Gemma over its quota: the draft stands as Gemini read it, marked `unavailable`. A Gemma outage never stops ordering.

The `draft.created` event carries the result (`crossCheck`), so the demo page shows when the two readers agree.

## Check it yourself

The door signs what it says and chains what it did, so you can check it without trusting it. Everything below works with
`curl` and Node, no key needed.

```bash
D=https://lazydoor.lazydoor.workers.dev
curl -s $D/.well-known/agent-gateway.json   # discovery: API, MCP, rules, events, audit, keys, approval model, demo
curl -s $D/.well-known/jwks.json            # the door's Ed25519 public key (kid = RFC 7638 thumbprint)
curl -s $D/v1/audit/verify                  # the whole event chain recomputed, and the result signed
node scripts/verify-audit.mjs $D            # recompute the chain yourself and check the signed head against the JWKS
```

- **Hash-chained events.** Each event in `/v1/events` carries `prevHash` and `hash` = sha256 of `prevHash` followed by the
  RFC 8785 canonical JSON of the event without those two fields; the first event after a reset links to 64 zeros. The exact
  rule is in [docs/events.md](docs/events.md#hash-chain). `GET /v1/audit/verify` recomputes the chain, names the first bad
  seq if any, and signs `{ count, firstSeq, headSeq, headHash, valid, checkedAt }` with the door key. On the demo door,
  `POST /admin/tamper` (admin key) changes one event behind the door's back, and verify then names its seq.
- **Signed quotes.** Every quote offer carries `jws`, a compact EdDSA JWS over the quote, offer and buyer, the delivery date,
  every line (product, sales units, unit price, line net), the totals, currency, `validUntil` (the quote expiry: the earliest
  of 30 minutes and the Valio cut-off), `iat` and `aud: "lazydoor:quote"`. An agent can verify it against the JWKS before
  ordering (the reference agent does and logs `quote signature verified`) and send it back as `quoteJws`: the door places the
  order only when the signature verifies and every field equals the offer as quoted, else `QUOTE_SIGNATURE_INVALID`.
- **Signed receipts.** Once an order is final (accepted, rejected or expired), the order reply, `GET /v1/orders/{id}` and the
  receipt carry `jws` over the order id, buyer, state, lines, totals, who approved it and when it was decided
  (`aud: "lazydoor:receipt"`). A held order gets its receipt when the approver decides.

## Try it (demo door only)

A visitor can order as the chef of their own sandbox kitchen, with no key, and decide held orders as its kitchen manager.
The door runs the same path as the reference agent, with no model choosing anything: interpret (Gemini, read again by
Gemma), confirm with the agent's profile default, quote, place the cheapest covering offer. It exists only where
`DEMO_MODE=1`; elsewhere both routes are 404 before any validation.

`POST /v1/try` takes `{ text }` (1 to 200 characters after trimming) for a new request, or `{ visitor, draftId, answer }` to answer the question about a draft: a disagreement button `{ field: "deliverBy", value: "YYYY-MM-DD" }`, or words `{ text }` (below). Add `visitor` to a new request to keep the same sandbox.
- **First call.** It opens a sandbox kitchen: buyer `visitor-<8 hex>`, the kitchen mandate (automatic up to 500 € an order and
  1,500 € a day, hard stop at 5,000 and 10,000, no new allergen, default reliability floor), approver "You (kitchen manager)".
  It returns a `visitor` token (24 random bytes; the door stores only its sha256).
- **Reply 200.** `{ visitor, buyerId, step, draft?, question?, quote?, order?, approval? }`:
  - `step: "needs_input"` when a field is still open. `question` is `{ field, readings: [{ model, value }] }`. When `field`
    is `deliverBy`, answer with the date; any other field means the sentence needs rewording.
  - `step: "no_offer"` with `quote.rejections` when nothing can be ordered.
  - `step: "decided"` with `quote` (`quoteId`, `offers`, `rejections`, and `jws` of the placed offer) and
    `order` (`orderId`, `state`, `reasons: [{ code, detail }]`, `netCents`, `grossCents`).
  - A `HELD` order also carries `approval: { token, expiresAt }`, because the visitor is that sandbox's kitchen manager.
- **Answering in words.** `{ visitor, draftId, answer: { text } }` (1 to 200 characters) continues the visitor's own waiting
  draft. The door re-reads "<the draft's text>. <answer>" with both models, with the door clock as today, so "next tuesday"
  becomes a date, and merges the result:
  - fields the draft already knew stay;
  - missing fields are filled from the new reading;
  - a field the answer changes is asked, like any disagreement.

  Every `needs_input` reply has `question: { field, text, readings }`, where `text` is a plain question such as "When should
  it arrive?", "How much?" or "Which product?". An answer in words counts like a free-text try. Another visitor's draft is
  404.
- **Speaking a request.** Behind the feature flag `voice` (off: 404), `POST /v1/try/voice` takes the raw audio clip a
  browser MediaRecorder sends (`Content-Type` `audio/webm`, `audio/ogg`, `audio/mp4` or `audio/wav`, parameters such as
  `;codecs=opus` allowed; else 415 `UNSUPPORTED_MEDIA_TYPE`; over 1 MB is 413) and returns `{ transcript }` (at most 200
  characters). Gemini only transcribes (temperature 0, no tools); it never interprets, quotes or orders, so the page sends
  the transcript to `/v1/try` as a normal request. The 30 s limit is the page recorder's; the door enforces size only.
  Optional `X-Visitor-Token` counts against that visitor (unknown: 404 `VISITOR_UNKNOWN`); every clip also counts against
  the address and the shared free-text model bucket (429 `TRY_RATE_LIMITED`). No clear speech is 400 `TRANSCRIPT_EMPTY`;
  Gemini over quota is 503 `MODELS_BUSY` with `retryAfter`, any other model failure 503 `MODEL_UNAVAILABLE`. The audio
  and transcript are never logged.
- **Deciding.** `POST /v1/try/decision` with `{ visitor, token, decision: "approve" | "reject" }` goes through the normal
  approval path, re-check included (`APPROVAL_EXPIRED`, `STOCK_TAKEN`, `PRICE_CHANGED` still apply), and answers
  `{ order: { orderId, state, reasons } }`. Only a token of the visitor's own sandbox works: any other is 404 `TOKEN_UNKNOWN`.
  An agent or judge key is 403 `AGENT_CANNOT_APPROVE`.
- **Limits** (sized for a venue where everyone shares one public address):
  - 3 calls a minute per visitor token (both routes).
  - 60 calls a minute per client address, as a flood guard. An IPv6 address counts by its /64.
  - 6 free-text tries a minute for everyone, because each asks Gemini and Gemma. The page's 4 example sentences are served
    from recorded readings (`src/try/recorded.ts`, recorded with `scripts/record-readings.ts`), marked `cached: true` on the
    draft and the event, and ask no model.
  - 240 calls a minute for everyone. Over any limit is 429 `TRY_RATE_LIMITED` with `retryAfter`.
  - When Gemini is over its quota, a free-text try gets 503 `MODELS_BUSY` with `retryAfter` and a pointer to the examples.
  - No new visitor is turned away for space. A sandbox idle for 20 minutes is removed with its orders, quotes and drafts
    (its events stay in the chain). Past 500 sandboxes, or 200 from one address, the least recently used one is recycled.
    A removed visitor gets 404 `VISITOR_UNKNOWN` and starts again.
  - A first call that fails frees its sandbox again. Bodies over 4 KB get 413.
  - Each new `text` is a new order: a retried text call orders again.
- **Switching it off.** `node scripts/demo-admin.mjs try-off` (admin key) makes both routes 404 at once, so the page hides
  the panel. `try-on` brings it back, and `node scripts/demo-admin.mjs reset` (the standard state for the next round)
  switches it on too.
- **Own stock world.** Sandbox orders count only against other sandbox orders. A visitor can never take the stock that the
  real buyers' quotes and orders are checked against, but visitors do compete with each other.
- **Events.** Every step logs events under the sandbox's buyer id, so Live shows them.
- **Many viewers.** Event reads and streams share one tail of recent events per Worker isolate. It is refreshed at most every
  1.5 s, and at once after a write in that isolate. Streams read it every 2 s, so a hundred Live viewers cost a few database
  reads a second, not a hundred.

## Quick start

You need Node 24, pnpm 10 and wrangler 4.

```bash
pnpm install
```

Create `.dev.vars` (gitignored) with these names. Put your own values in. Never commit them.

```
VALIO_API_KEY=
ADMIN_KEY=
GEMINI_API_KEY=
DOOR_SIGNING_JWK=
```

`DOOR_SIGNING_JWK` is the door's private Ed25519 key as one line of JWK JSON. `node scripts/door-key.mjs <file>` writes a new
one to a file (mode 600) and prints only its `kid`; paste the file's line after `DOOR_SIGNING_JWK=`. A deployed door gets its
own key with `wrangler secret put DOOR_SIGNING_JWK < <file>`. Tests generate a fresh key per run.

`GEMINI_API_KEY` is optional, but `pnpm categories:build` calls Gemini and needs it. Without it, free-text interpretation is unavailable and the cases that need a real model report `BLOCKED_ON_GEMINI`. Everything else works.

Get the challenge data (never committed, see the data notice below), then build and load the local database.

```bash
bash research/fetch_data.sh   # downloads into .data/valio/ (set VALIO_API_KEY to also record replies)
pnpm index:build
pnpm replies:build
pnpm categories:build
pnpm dev:load                 # migrations, product index, recorded replies, categories (local D1)
pnpm pg:local                 # Postgres 18 in Docker on port 54329 (the write store; tables are created on first reset)
pnpm wrangler dev             # serves the Worker on http://localhost:8787
```

Then, in another shell:

```bash
pnpm test                     # unit tests (vitest in workerd, real D1 and the local Postgres)
pnpm acceptance               # 49 acceptance cases against the running Worker
```

`pnpm acceptance` resets the gateway through the demo-only admin routes and mints its own agent and approver keys. It reads `ADMIN_KEY` from the shell, default `dev-admin-key`, and that must match `ADMIN_KEY` in `.dev.vars`. Set `GATEWAY_URL` to run it against another deployment.

The reference agent and the model-free scenarios:

```bash
pnpm scenarios                # 11 PASS/FAIL scenarios that drive the demo flows below, no model
pnpm agent                    # the buyer agent on the brief's example (needs GEMINI_API_KEY)
```

The scenarios use the demo-only admin routes (reset, clock, replay), so they work only where `DEMO_MODE=1`. Details in [agent/README.md](agent/README.md).

## Interfaces

| What | Where |
|---|---|
| OpenAPI 3 document | `GET /openapi.json` |
| MCP (streamable HTTP) | `/mcp`, with 9 tools: `interpret_request`, `confirm_draft`, `search_products`, `get_quote`, `quote_basket`, `place_order`, `get_order`, `resolve_product`, `list_families` |
| Decision register | `GET /v1/rules` (public) |
| Reason codes | `GET /v1/reason-codes` (public); also [docs/reason-codes.md](docs/reason-codes.md) |
| Events | `GET /v1/events` (polling) and `GET /v1/events/stream` (Server-Sent Events), hash-chained; schema in [docs/events.md](docs/events.md) |
| Audit | `GET /v1/audit/verify` (public): the recomputed chain, signed |
| Signing key | `GET /.well-known/jwks.json` (public): verifies quote offers, receipts and audit results |
| Discovery | `GET /.well-known/agent-gateway.json` (public): where everything above is, the approval model, the demo and the code |
| Approver | `GET /approver/{approverKey}` (inbox), `GET /approve/{token}` (phone page), `POST /approve/{token}` and `POST /reject/{token}` |
| Receipt | `GET /v1/orders/{id}/receipt` (plain text, buyer key); `GET /receipt/{orderId}` (plain text, no key: the order id is the capability URL, so share it only with whoever may see the receipt) |
| Health | `GET /health` |

The agent routes are `POST /v1/interpret`, `/v1/drafts/{id}/confirm`, `/v1/search`, `/v1/quotes`, `/v1/baskets`, `/v1/orders`, `/v1/resolve`, and `GET /v1/families`, `/v1/quotes/{id}` and `/v1/orders/{id}`. Every `/v1` route except `/v1/rules`, `/v1/reason-codes`, `/v1/audit/verify` and Try it (demo door only) needs `Authorization: Bearer <key>`, and so does `/mcp`. The one exception is the event log on a demo door: with `DEMO_MODE=1`, `GET /v1/events` and `/v1/events/stream` also answer a request with no key at all, read-only and for every buyer, so the public demo page can watch the door (a wrong key is still 401). `/health` and `/openapi.json` are open. HTTP and MCP share one schema.

**Demo page.** The animated demo (story and Live mode) is served by the same Worker at [`/demo/`](https://lazydoor.lazydoor.workers.dev/demo/), as Workers static assets. `scripts/build-demo.mjs` copies only the files the page loads into `dist/assets/demo/` (wrangler runs it before every deploy, `pnpm test` before every run); `demo/dev/`, `demo/test/`, `demo/shots/`, the notes and `story.mp4` stay unpublished. Live mode reads `/v1/events` from the page's own origin.

`POST /v1/orders` follows the ACP idempotency rules: a missing `Idempotency-Key` is 400, the same key in flight is 409, the same key with another body is 422. A retry with the same key and body returns the same order.

**Judge key.** The operator mints a read-everything key with `POST /admin/judge-key` (admin key, `DEMO_MODE=1`); it returns `{ key }` once. The key acts as buyer `hotel-b` (it can place orders as `hotel-b`) and reads every buyer's events. It survives `/admin/reset`; agent and approver keys do not.

**Deploying.** The remote D1 catalog is filled once with `pnpm migrate:remote`, `pnpm index:load:remote`, `pnpm replies:load:remote` and `pnpm categories:load:remote` (the local `dev:load` equivalents run against `--local`). The write store is a Hyperdrive config (caching disabled, so every read sees the last write) in front of the Aiven service; its id goes in `wrangler.jsonc`, and `POST /admin/reset` creates the tables. A schema change is always `ADD COLUMN IF NOT EXISTS`, so apply `SCHEMA` (`src/db.ts`) to the database before deploying the code that reads the new columns (the running code ignores them), then reset the demo. The door's signing key is the Worker secret `DOOR_SIGNING_JWK` (`node scripts/door-key.mjs <file>`, then `wrangler secret put DOOR_SIGNING_JWK < <file>`); without it the door refuses quotes and orders before anything is booked.

The agent never receives the approval link. `place_order` returns only the approval status and the approver's name. The link goes to the approver inbox.

## The demo

These flows are acceptance cases and run against recorded Valio replies.

1. **The cut-off trap.** Valio's availability says product `463038` (a 10 l milk box) has "999999 on Monday". Its cut-off passed on Thursday. A naive agent orders milk that never arrives. Lazydoor rejects it as `CUTOFF_PASSED`.
2. **The split trick.** An order of 1,000 l split into 334 + 333 + 333 l, so each part stays under the automatic limit. The first is accepted. The second is `HELD` with `OVER_DAY_AUTO`, because the day total is counted. A human must approve.
3. **The agent approves itself.** The agent calls the approve route with its own key. It gets 403 (`AGENT_CANNOT_APPROVE`). The order stays `HELD`.
4. **Two agents, six units.** Two buyers order the same product at the same time, and there is stock for only one. The first commit wins and gets one receipt. The other is refused with `STOCK_TAKEN` and is told how much is left.

## What is simulated

Be clear about what this prototype does not do.

- **Order acceptance is simulated.** Valio has no order endpoint in the challenge. The receipt says "Accepted = binding order, invoiced on delivery (simulated)". The ledger is a **mock ledger adapter** in the door's PostgreSQL (Aiven). Valio's order API and allocation rule would replace it at the same call.
- **Allocation is a stand-in.** Stock is allocated first come, first served against the Valio availability amount less accepted ledger lines. One transaction inserts all lines of an order or none. A quote and a held order reserve nothing.
- **Replay.** After Sunday 15 Nov 17:00 (Helsinki) the gateway serves the recording made on Friday 13 Nov at 21:08 instead of calling Valio. Before that it calls Valio live. Replay switches on by itself only when the gateway clock is real time (no override) and has passed Sun 15 Nov 17:00 Helsinki; a demo reset with a set clock must pass `replay: "replies_2026-11-16"` to replay. Running the scenarios or acceptance against a deployed URL leaves that run's last state, so finish with one explicit demo reset (`clock: 2026-11-13T21:10:00+02:00`, `replay: replies_2026-11-16`). The demo clock can be set with the demo-only admin routes (`DEMO_MODE=1` and the admin key; otherwise 404). The deployed instance keeps `DEMO_MODE=1` so the demo can set the clock and replay. Its admin routes are protected by a long random `ADMIN_KEY` Worker secret.
- **Payments, invoices and delivery** are not implemented.
- **Mandate.** A mandate is a bearer JWS (Ed25519, signed per buyer, checked on every order). It has no key binding to the agent, so anyone holding it could present it. AP2-style key binding is out of scope.

**Accepted = binding order, invoiced on delivery.** In production, an ACCEPTED order is a binding order that Valio invoices on delivery. A quote is binding until it expires or the earliest Valio cut-off.

## What Valio must add

For this to run in production, Valio needs to provide:

1. **An order endpoint**, with idempotency, in place of the mock ledger.
2. **The allocation rule**, so "first come, first served" matches what Valio really does when stock is short.
3. **Category names** (the challenge gives numeric category ids only). Lazydoor names them with Gemini for now (`pnpm categories:build`).
4. **A cut-off calendar**: today it is inferred from availability replies, which still say "999999 on Monday" after the cut-off.
5. **Date-aware availability**: a stock figure per delivery date, not a single sentinel number.

## Standards map

| Standard | How Lazydoor relates |
|---|---|
| MCP | The door is an MCP server (`/mcp`, 9 tools with output schemas). Business refusals set `isError`. |
| ACP (Agentic Commerce Protocol) | `POST /v1/orders` follows its idempotency rules. |
| AP2 (Agent Payments Protocol) | The signed buyer mandate plays the role of its mandate. It is a bearer JWS with no key binding, and says so. |
| UCP (Universal Commerce Protocol) | Not implemented. The catalogue, quote and order shapes are plain typed JSON, but there is no UCP endpoint. |
| Peppol Order Response | The mapping is by design, not an emitted document. ACCEPTED = `AP`, REJECTED = `RE`, a SHORTFALL or substitute line = `CA`. |
| JOSE (RFC 7515, 7517, 7638, 8037) and JCS (RFC 8785) | Quote offers, receipts and the audit head are compact EdDSA JWS; the key is a JWK Set with an RFC 7638 thumbprint `kid`; signed claims and the event chain use RFC 8785 canonical JSON. |

## Reason codes

Every refusal, change and approval carries a code from one table, with a plain sentence, who can resolve it and whether a retry may help. See [docs/reason-codes.md](docs/reason-codes.md). That file is generated from `src/domain/reasons.ts`:

```bash
pnpm exec tsx scripts/reason-codes-md.ts
```

## Data notice

The Valio challenge data may only be used for this challenge. It is never committed. `.data/` is gitignored and `research/fetch_data.sh` downloads it. Unit-test fixtures are synthetic. Secrets live in `.dev.vars` or Worker secrets, and `pnpm test` runs `scripts/check-secrets.sh` first.

## License

MIT. See [LICENSE](LICENSE).
