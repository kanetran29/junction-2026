# Lazydoor Demo Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An isometric animated scene of Lazydoor (chef, buyer agent, door, Valio warehouse, manager's phone, cut-off clock, truck) driven by one event reducer, fed either by a scripted 2-minute story or by the live gateway event stream.

**Architecture:** One pure reducer turns gateway events (schema below) into scene state; the scene draws state with eased motion. Story mode feeds a deterministic timeline of the same events plus `story.*` cue events; Live mode feeds Server-Sent Events from the gateway (polling fallback) or a recorded event file. Static ES modules only, so the Worker can serve `demo/` at `/demo`.

**Tech Stack:** Plain ES modules in the browser, isometric SVG from the anatomy kit (`demo/kit/iso-kit.mjs`, copied), `node --test` for tests (Node 24, no dependencies), a Node fake gateway for development, Playwright + ffmpeg for the recording.

**Spec:** the approved design in the session brief (copied into `demo/STATUS.md`, "Brief"); gateway design `docs/superpowers/specs/2026-11-13-trusted-trade-gateway-design.md`; facts from `research/acceptance/expected_facts.json` and `research/ANALYSIS.md` §4.3.

## Global Constraints

- Only touch `demo/`, `docs/superpowers/` and `demo/STATUS.md`; never commit to or push `main`; push branch `demo-animation` only.
- Event envelope: `{ seq, ts, type, buyerId, draftId?, quoteId?, orderId?, data }`. Types: `draft.created {text, category, claims, quantity, unclear}`, `draft.confirmed`, `search.done {count, categories}`, `valio.called {endpoint, ids, replay}`, `quote.created {offers:[{offerId, lines:[{productId, salesUnits}], netCents, changes}], rejections:[{productId, code}]}`, `policy.decided {outcome, reasons}`, `approval.requested {orderId, expiresAt}`, `approval.approved`, `approval.rejected`, `approval.expired`, `order.accepted {lines, netCents}`, `stock.denied {productId, remaining}`, `clock.set {now}`. Re-check `docs/events.md` on `main` before merging.
- Live endpoints: `GET /v1/events/stream?buyer=&since=` (SSE), `GET /v1/events?since=` (polling), `POST /v1/interpret`; bearer key in `Authorization`, so SSE is read with `fetch` streaming, not `EventSource`.
- Story facts: cut-off Sun 15 Nov 17:00 (+02:00); 463038 Valio 10 l novobox CUTOFF_PASSED (closed Thu 12 Nov 15:00, raw API says 999999 on Mon 16 Nov); 469363 Arla 1 l STOCK_LIMITED 384; chosen 464306 Valio Eila 1 l × 1,000 at 1.01 €/l = 1,010.00 € net; NEEDS_APPROVAL `OVER_ORDER_AUTO` + `PACK_SIZE_CHANGED`; delivery Mon 16 Nov; allergen case 468465 Oddlygood oat drink → 470863 Oatly adds AW → `NEW_ALLERGEN`; "1000 cases" = 20,000 l → REJECT `OVER_ORDER_HARD`; split orders → `OVER_DAY_AUTO`; clock to Sun 15 Nov 17:05 → `approval.expired`. Closing line: "Lazy at the order, strict at the border."
- Colour only for the stamp: AUTO green, NEEDS_APPROVAL amber, REJECT red; everything else monochrome kit tones.

## Review Focus

1. Gateway down, wrong URL or 401 → a status chip says so and retries; the scene keeps drawing; nothing throws (Task 3 test `live: fetch failure reports down`).
2. Reconnect replays events already seen → each `seq` is applied once (Task 1 test `reduce: ignores seq not above last`).
3. Unknown event type or missing `data` fields → logged, scene unchanged, no throw (Task 1 test `reduce: tolerates unknown and partial events`).
4. A quote with more products than shelves → first slots used, the rest counted on the last tag (Task 1 test `reduce: more products than shelves`).
5. SSE frames split across network chunks → events still parsed whole (Task 3 test `sse: frame split across chunks`).

---

### Task 1: Event reducer

**Files:** Create `demo/model.mjs`. Test `demo/test/model.test.mjs`.

**Interfaces:**
- Produces: `initialState(): State`; `reduce(state, event, t): State` (pure, returns a new object; `t` is scene seconds, stored on sub-states as `since`); `euro(cents): string` (`101000 → "1,010.00 €"`); `countdown(nowIso, cutoffIso): string` (`"43 h 51 min"`, `"closed"`); `SHELVES = 4`.
- State: `{ seq, now, replay, caption, draft, agent:{at, carry, since}, door:{scan, stamp, reasons, since}, shelves:[{productId, status, remaining, more}], phone:{status, orderId, expiresAt, cents, since}, truck:{status, crates, since}, naive:{step, since}, close, log:[{seq, type, text}] }`. `agent.at ∈ home|chef|door|truck`; shelf `status ∈ idle|ok|locked|limited|crossed`; stamp `null|AUTO|NEEDS_APPROVAL|REJECT`; phone `idle|buzzing|approved|rejected|expired`; truck `parked|loading|stuck`.

- [ ] Write tests: happy path (draft.created → agent at chef with draft; draft.confirmed → door; quote.created marks 463038 locked, 469363 limited 384, 464306 ok; policy.decided NEEDS_APPROVAL; approval.requested → phone buzzing with expiresAt; approval.approved; order.accepted → truck loading); REJECT sends agent home with `carry: "rejected"`; NEW_ALLERGEN and SUBTYPE_MISMATCH cross the shelf; `stock.denied` sets remaining; `clock.set` sets `now`; `valio.called` with `replay: true` sets `replay`; plus Review Focus 2–4. Run `node --test demo/test/` → FAIL.
- [ ] Implement, run → PASS. Commit `feat(demo): event reducer`.

### Task 2: Story timeline

**Files:** Create `demo/story.mjs`. Test `demo/test/story.test.mjs`.

**Interfaces:**
- Consumes: `reduce`, `initialState` (Task 1).
- Produces: `STORY: Array<{ at: number, ev: Event }>` sorted by `at`; `DURATION` (seconds, 115–125); `stateAt(t): State` (reduce every item with `at ≤ t`); `gatewayEvents(): Event[]` (the non-`story.*` events with seq/ts, for the recorded fixture). Story cue types: `story.caption {text}`, `story.naive {step: enter|grab|load|stuck|gone}`, `story.reset`, `story.close`.

- [ ] Write tests: beats in order (naive before the Lazydoor run, attacks after `order.accepted`, close last); `stateAt(DURATION)` has close shown; at the end of beat 3 the phone is approved and the truck loaded with offer total 101000; the allergen beat crosses 470863; the clock beat leaves the phone `expired`; seq strictly increasing; `stateAt` deterministic (two calls deep-equal). Run → FAIL.
- [ ] Implement, PASS. Commit `feat(demo): two-minute story timeline`.

### Task 3: Live source

**Files:** Create `demo/live.mjs`. Test `demo/test/live.test.mjs`.

**Interfaces:**
- Produces: `sseFeed(): (chunk: string) => Event[]` (stateful parser of `data:` frames, JSON per frame, comments and bad JSON skipped); `connectLive({ base, key, buyer, since, onEvent, onStatus, fetchImpl, signal })` (stream, then poll every 1.5 s on stream failure, back off to 10 s while down; `onStatus` ∈ `connecting|streaming|polling|down`; never rejects); `replayFile({ url, onEvent, signal, speed })` (JSON array, ts gaps capped at 2.5 s); `sendRequest({ base, key, buyer, text, fetchImpl })` → `{ ok, step, error }` (interpret → confirm → quote → order with `Idempotency-Key`, picks offer 0).

- [ ] Write tests with a stub `fetchImpl`: SSE split frames; fetch failure → `down` then retry; polling applies `since`; `sendRequest` stops at an `unclear` draft and reports it. Run → FAIL.
- [ ] Implement, PASS. Commit `feat(demo): live event source`.

### Task 4: Scene and page

**Files:** Create `demo/index.html`, `demo/demo.css`, `demo/scene.mjs`, `demo/main.mjs`, copy `demo/kit/iso-kit.mjs` and `demo/kit/iso.css` from the anatomy skill.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `buildScene(host): Scene`, `scene.draw(state, t, dt)`; URL params `?mode=story|live`, `&gateway=`, `&key=`, `&buyer=`, `&theme=light|dark`, `&autoplay=1`, `&t=` (seek).

- [ ] Build static geometry once (azimuth 45, x = flow left to right: kitchen → door → warehouse → dock), moving parts as `<g>` moved with `translateAlong`; draw from state with exponential follow; stamp colours; displays (phone, clock, shelf tags, truck board) as text in face planes.
- [ ] Story controls (play/pause, restart, scrub), caption, event ticker, replay badge, status chip; Live panel (gateway URL, key, buyer, connect, request input).
- [ ] Verify with headless screenshots at 5 story moments, light and dark, and at 390 px. Commit `feat(demo): isometric scene, story and live modes`.

### Task 5: Fake gateway and recorded file

**Files:** Create `demo/dev/fake-gateway.mjs`, `demo/fixtures/sample-events.json`.

- [ ] `node demo/dev/fake-gateway.mjs` serves `demo/` and implements the three event endpoints from `gatewayEvents()` (paced), plus `POST /v1/interpret` and the chain, emitting events. Write the fixture from `gatewayEvents()`.
- [ ] Verify Live mode against the fake (SSE and with SSE disabled → polling), against the fixture, against a stopped gateway, then against `wrangler dev` when `main` has the endpoint. Commit `feat(demo): fake gateway and recorded events`.

### Task 6: Recording and hand-over

- [ ] Record Story mode at 1600×900 with Playwright `recordVideo`, convert to `demo/story.mp4` (H.264, yuv420p, faststart). Watch frames.
- [ ] Update `demo/STATUS.md`, push `demo-animation`. Commit `docs(demo): status and recording`.
