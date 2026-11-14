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
- **Buyer rules:** the signed mandate. Default: auto-approve up to 500 EUR per order and per day. Hard stop at 5,000 EUR per order and 10,000 EUR per day. No new allergen. Delivery reliability at least 0.9.
- **Approver:** a held order is accepted only when the named human approves it through their own link.
- **The only model step:** turning free text into a typed draft (Gemini, `interpret_request`). Policy and money never read that output directly.

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
```

`GEMINI_API_KEY` is optional, but `pnpm categories:build` calls Gemini and needs it. Without it, free-text interpretation is unavailable and the cases that need a real model report `BLOCKED_ON_GEMINI`. Everything else works.

Get the challenge data (never committed, see the data notice below), then build and load the local database.

```bash
bash research/fetch_data.sh   # downloads into .data/valio/ (set VALIO_API_KEY to also record replies)
pnpm index:build
pnpm replies:build
pnpm categories:build
pnpm dev:load                 # migrations, product index, recorded replies, categories (local D1)
pnpm wrangler dev             # serves the Worker on http://localhost:8787
```

Then, in another shell:

```bash
pnpm test                     # unit tests (vitest in workerd, real D1)
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
| Events | `GET /v1/events` (polling) and `GET /v1/events/stream` (Server-Sent Events); schema in [docs/events.md](docs/events.md) |
| Approver | `GET /approver/{approverKey}` (inbox), `GET /approve/{token}` (phone page), `POST /approve/{token}` and `POST /reject/{token}` |
| Receipt | `GET /v1/orders/{id}/receipt` (plain text, buyer key); `GET /receipt/{orderId}` (plain text, no key: the order id is the capability URL, so share it only with whoever may see the receipt) |
| Health | `GET /health` |

The agent routes are `POST /v1/interpret`, `/v1/drafts/{id}/confirm`, `/v1/search`, `/v1/quotes`, `/v1/baskets`, `/v1/orders`, `/v1/resolve`, and `GET /v1/families`, `/v1/quotes/{id}` and `/v1/orders/{id}`. Every `/v1` route except `/v1/rules` and `/v1/reason-codes` needs `Authorization: Bearer <key>`, and so does `/mcp`. `/health` and `/openapi.json` are open. HTTP and MCP share one schema.

`POST /v1/orders` follows the ACP idempotency rules: a missing `Idempotency-Key` is 400, the same key in flight is 409, the same key with another body is 422. A retry with the same key and body returns the same order.

**Judge key.** The operator mints a read-everything key with `POST /admin/judge-key` (admin key, `DEMO_MODE=1`); it returns `{ key }` once. The key acts as buyer `hotel-b` (it can place orders as `hotel-b`) and reads every buyer's events. It survives `/admin/reset`; agent and approver keys do not.

**Deploying.** The remote D1 database is filled with `pnpm migrate:remote`, `pnpm index:load:remote`, `pnpm replies:load:remote` and `pnpm categories:load:remote` (the local `dev:load` equivalents run against `--local`).

The agent never receives the approval link. `place_order` returns only the approval status and the approver's name. The link goes to the approver inbox.

## The demo

These flows are acceptance cases and run against recorded Valio replies.

1. **The cut-off trap.** Valio's availability says product `463038` (a 10 l milk box) has "999999 on Monday". Its cut-off passed on Thursday. A naive agent orders milk that never arrives. Lazydoor rejects it as `CUTOFF_PASSED`.
2. **The split trick.** An order of 1,000 l split into 334 + 333 + 333 l, so each part stays under the automatic limit. The first is accepted. The second is `HELD` with `OVER_DAY_AUTO`, because the day total is counted. A human must approve.
3. **The agent approves itself.** The agent calls the approve route with its own key. It gets 403 (`AGENT_CANNOT_APPROVE`). The order stays `HELD`.
4. **Two agents, six units.** Two buyers order the same product at the same time, and there is stock for only one. The first commit wins and gets one receipt. The other is refused with `STOCK_TAKEN` and is told how much is left.

## What is simulated

Be clear about what this prototype does not do.

- **Order acceptance is simulated.** Valio has no order endpoint in the challenge. The receipt says "Accepted = binding order, invoiced on delivery (simulated)". The ledger is a **mock ledger adapter** in the Worker's D1 database. Valio's order API and allocation rule would replace it at the same call.
- **Allocation is a stand-in.** Stock is allocated first come, first served against the Valio availability amount less accepted ledger lines. One SQL statement inserts all lines of an order or none. A quote and a held order reserve nothing.
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

## Reason codes

Every refusal, change and approval carries a code from one table, with a plain sentence, who can resolve it and whether a retry may help. See [docs/reason-codes.md](docs/reason-codes.md). That file is generated from `src/domain/reasons.ts`:

```bash
pnpm exec tsx scripts/reason-codes-md.ts
```

## Data notice

The Valio challenge data may only be used for this challenge. It is never committed. `.data/` is gitignored and `research/fetch_data.sh` downloads it. Unit-test fixtures are synthetic. Secrets live in `.dev.vars` or Worker secrets, and `pnpm test` runs `scripts/check-secrets.sh` first.

## License

MIT. See [LICENSE](LICENSE).
