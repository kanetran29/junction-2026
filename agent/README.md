# Lazydoor buyer agent and demo scenarios

Two things share this folder: `buyer.ts`, a purchasing agent driven by Gemini function calling over the door's MCP tools, and
`scenarios.ts`, the same guardrails shown without a model (typed HTTP calls, PASS/FAIL per scenario).

## Run against `wrangler dev`

```
pnpm dev:load && pnpm exec wrangler dev            # gateway on :8787 (DEMO_MODE on)
pnpm scenarios                                     # 11 scenarios, exit 1 on any FAIL
pnpm agent                                         # the brief's example; or: pnpm agent "50 kg of chicken breast by Monday"
```

Environment: `GATEWAY_URL` (default `http://localhost:8787`), `ADMIN_KEY` (default `dev-admin-key`), `GEMINI_API_KEY` (from
`.dev.vars`; without it the agent prints `BLOCKED_ON_GEMINI: set GEMINI_API_KEY` and exits 0), `GEMINI_MODEL`
(default `gemini-3.8-flash`), `AGENT_KEY` (skip the demo reset and use this key), `POLL_MS` / `POLL_MAX` (how long a HELD order is waited on).

## Against the deployed URL

`GATEWAY_URL=https://<worker> AGENT_KEY=<the agent key> GEMINI_API_KEY=... pnpm agent`. `scenarios` and the keyless agent start
need the demo admin routes (`DEMO_MODE=1`, `ADMIN_KEY`), so use them only on a demo deployment.

## What the agent may and may not do

- It holds only the agent key. It reads and quotes the catalogue, confirms its own draft (filling fat level and pack size from the buyer profile) and places an order with an idempotency key and a one-sentence `agentReason`.
- It picks the offer with `chooseWithinMandate`: the cheapest covering offer, or one that stays inside the automatic limit when it costs at most 5 % more. The gateway still decides; the choice never changes a limit.
- On a HELD order it prints who must approve and re-reads the order, bounded. It never sees an approval link and never holds the approver key (the demo wrapper prints the human's inbox URL once, for the person demoing).
- It cannot approve (the gateway answers 403 to an agent key), split an order around a limit (the day total catches it) or retry a REJECTED order.
