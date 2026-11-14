// Development stand-in for the Lazydoor gateway: serves demo/ and the event endpoints from the docs/events.md schema.
// Run: node demo/dev/fake-gateway.mjs [--port 8790] [--no-sse] [--replay [file]] [--pace 1]
//   --no-sse   the stream endpoint answers 404, so the page falls back to polling
//   --replay   replays a recorded run (default fixtures/story-v2.json) once a viewer reads the event log; --pace scales its gaps
//   --no-try   the "Try it" sandbox routes answer 404, as on a door that is not in demo mode
//   --door URL passes the door's public read routes (rules, reason codes, audit, keys, discovery, OpenAPI) through to that door,
//              so the Inside tab shows real results locally; without it they answer 404 ("coming with the next deploy")
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => process.argv.includes(name);
const option = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const PORT = Number(option("--port")) || 8790;
const TYPES = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".pdf": "application/pdf" };
const events = [];
const listeners = new Set();
const CENTS_PER_L = 101;
let ids = 0;

/** Appends an event to the log and pushes it to every open stream. */
function emit(type, data, extra = {}) {
  const ev = { seq: events.length + 1, ts: new Date().toISOString(), type, buyerId: extra.buyerId ?? "hotel-a", ...extra, data };
  events.push(ev);
  for (const send of listeners) send(ev);
  return ev;
}

const later = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
};
const body = (req) => new Promise((resolve) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
});

const drafts = new Map();
const quotes = new Map();

/** A crude stand-in for interpret: litres from "<n> l" or "<n> cases" (20 l each). */
function interpret(text) {
  const n = Number((String(text).match(/([\d][\d,. ]*)/) || [])[1]?.replace(/[ ,]/g, ""));
  const cases = /case/i.test(text);
  const unclear = Number.isFinite(n) && n > 0 ? [] : ["quantity"];
  return { text, category: "10400", claims: /lactose/i.test(text) ? ["FREE_FROM_LACTOSE"] : [], quantity: unclear.length ? null : { value: cases ? n * 20 : n, unit: "l" }, unclear };
}

/** Visitors of "Try it": their sandbox buyer and recent tries; held orders by approval token. */
const visitors = new Map();
const approvals = new Map();
const TRY_PER_MINUTE = 8;

/**
 * POST /v1/try, deterministic by text: "…Friday…" asks which Friday (needs_input) until answered, "…oat…" has no offer,
 * "…milk…" is HELD over the kitchen's 500 € per-order limit, anything else is accepted AUTO. Events go to the log with the
 * visitor's sandbox buyerId, a step at a time, so the Live scene can follow them.
 */
async function tryRoute(req, res) {
  if (arg("--no-try")) return json(res, 404, { error: "not found" });
  const { text = "", visitor: given, draftId: answeredDraft, answer } = await body(req);
  const t = String(text).trim();
  if (!t || t.length > 200) return json(res, 400, { error: "INVALID_REQUEST", detail: "text must be 1 to 200 characters" });
  const visitor = given || randomUUID();
  const sandbox = visitors.get(visitor) ?? { buyerId: `visitor-${visitor.replace(/-/g, "").slice(0, 8)}`, tries: [] };
  visitors.set(visitor, sandbox);
  sandbox.tries = sandbox.tries.filter((at) => Date.now() - at < 60000);
  if (sandbox.tries.length >= TRY_PER_MINUTE) return json(res, 429, { error: "TRY_RATE_LIMITED", retryAfter: Math.ceil((60000 - (Date.now() - sandbox.tries[0])) / 1000) });
  sandbox.tries.push(Date.now());
  const who = { buyerId: sandbox.buyerId };
  const reply = (extra) => json(res, 200, { visitor, buyerId: sandbox.buyerId, ...extra });
  const step = async (ms, type, data, ids = {}) => {
    await later(ms);
    emit(type, data, { ...who, ...ids });
  };
  const friday = /friday/i.test(t);
  const draftId = answeredDraft || `drf_${++ids}`;
  if (friday && !answer) {
    const draft = { id: draftId, text: t, category: "18750", claims: [], quantity: { value: 40, unit: "kg" }, unclear: [] };
    await step(400, "draft.created", { ...draft, crossCheck: { model: "gemma-4-31b-it", result: "disagreed", fields: ["deliverBy"] } }, { draftId });
    return reply({ step: "needs_input", draft, question: { field: "deliverBy", readings: [{ model: "gemini-3.8-flash", value: "2026-11-13" }, { model: "gemma-4-31b-it", value: "2026-11-20" }] } });
  }
  const oat = /oat/i.test(t);
  const milk = !oat && /milk/i.test(t);
  const units = friday ? 40 : milk ? 1000 : oat ? 50 : 20;
  if (!answer) await step(400, "draft.created", { text: t, category: milk ? "10400" : oat ? "10402" : "18750", claims: milk ? ["FREE_FROM_LACTOSE"] : oat ? ["FREE_FROM_GLUTEN"] : [], quantity: { value: units, unit: milk || oat ? "l" : "kg" }, unclear: [], crossCheck: { model: "gemma-4-31b-it", result: "agreed", fields: [] } }, { draftId });
  await step(500, "draft.confirmed", {}, { draftId });
  const quoteId = `q_${++ids}`;
  await step(800, "search.done", { count: oat ? 2 : milk ? 35 : 107, categories: [] }, { draftId, quoteId });
  await step(500, "valio.called", { endpoint: "availability", ids: oat ? 2 : 35, replay: true }, { draftId, quoteId });
  await step(400, "valio.called", { endpoint: "price", ids: oat ? 2 : 35, replay: true }, { draftId, quoteId });
  if (oat) {
    const rejections = [{ productId: "468465", code: "NOT_ORDERABLE", detail: "no stock lines" }, { productId: "470863", code: "NEW_ALLERGEN", detail: "adds allergen AW" }];
    await step(800, "quote.created", { offers: [], rejections: rejections.map(({ productId, code }) => ({ productId, code })) }, { draftId, quoteId });
    return reply({ step: "no_offer", draft: { id: draftId }, quote: { quoteId, offers: [], rejections, jws: null } });
  }
  const netCents = milk ? 101000 : friday ? 30800 : 15400;
  const grossCents = Math.round(netCents * 1.135);
  const productId = milk ? "464306" : "472673";
  const offers = [{ offerId: "o1", lines: [{ productId, salesUnits: milk ? 1000 : units }], netCents, changes: [] }];
  await step(800, "quote.created", { offers, rejections: [] }, { draftId, quoteId });
  const orderId = `ord_${++ids}`;
  if (milk) {
    const reasons = [{ code: "OVER_ORDER_AUTO", detail: "1,010.00 € is over the kitchen's 500 € per-order limit" }];
    await step(700, "policy.decided", { outcome: "NEEDS_APPROVAL", reasons: reasons.map((r) => r.code) }, { quoteId, orderId });
    const token = randomUUID();
    approvals.set(token, { visitor, orderId, quoteId, offers, netCents, grossCents, who });
    await step(300, "approval.requested", { orderId, expiresAt: "2026-11-15T17:00:00+02:00" }, { quoteId, orderId });
    return reply({ step: "decided", quote: { quoteId, offers, rejections: [], jws: null }, order: { orderId, state: "HELD", reasons, netCents, grossCents }, approval: { token, expiresAt: "2026-11-15T17:00:00+02:00" } });
  }
  await step(700, "policy.decided", { outcome: "AUTO", reasons: [] }, { quoteId, orderId });
  await step(400, "order.accepted", { lines: offers[0].lines, netCents }, { quoteId, orderId });
  return reply({ step: "decided", quote: { quoteId, offers, rejections: [], jws: null }, order: { orderId, state: "ACCEPTED", reasons: [], netCents, grossCents } });
}

/** POST /v1/try/decision: the visitor, as the kitchen manager, approves or rejects their own held sandbox order. */
async function tryDecision(req, res) {
  if (arg("--no-try")) return json(res, 404, { error: "not found" });
  const { visitor, token, decision } = await body(req);
  const held = approvals.get(token);
  if (!held || held.visitor !== visitor || !["approve", "reject"].includes(decision)) return json(res, 409, { error: "INVALID_DECISION", detail: "unknown token, visitor or decision" });
  approvals.delete(token);
  const refs = { ...held.who, quoteId: held.quoteId, orderId: held.orderId };
  if (decision === "reject") {
    emit("approval.rejected", {}, refs);
    return json(res, 200, { order: { orderId: held.orderId, state: "REJECTED", reasons: [] } });
  }
  emit("approval.approved", {}, refs);
  await later(500);
  emit("order.accepted", { lines: held.offers[0].lines, netCents: held.netCents }, refs);
  return json(res, 200, { order: { orderId: held.orderId, state: "ACCEPTED", reasons: [], netCents: held.netCents, grossCents: held.grossCents } });
}

async function api(req, res, url) {
  if (req.method === "POST" && url.pathname === "/v1/try") return tryRoute(req, res);
  if (req.method === "POST" && url.pathname === "/v1/try/decision") return tryDecision(req, res);
  const buyerId = url.searchParams.get("buyer") || "hotel-a";
  // Reads need no key and return every buyer's events, like the door's event log in demo mode.
  if (req.method === "GET" && url.pathname.startsWith("/v1/events")) startReplay().catch((error) => console.error(`replay: ${error.message}`));
  if (req.method === "GET" && url.pathname === "/v1/events/stream") {
    if (arg("--no-sse")) return json(res, 404, { error: "stream disabled" });
    const since = Number(url.searchParams.get("since")) || 0;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": "*" });
    const send = (ev) => res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
    events.filter((e) => e.seq > since).forEach(send);
    listeners.add(send);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => (listeners.delete(send), clearInterval(ping)));
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/events") {
    const since = Number(url.searchParams.get("since")) || 0;
    return json(res, 200, { events: events.filter((e) => e.seq > since) });
  }
  if (req.method === "POST" && url.pathname === "/v1/interpret") {
    const { text = "" } = await body(req);
    const draft = { id: `drf_${++ids}`, ...interpret(text) };
    drafts.set(draft.id, draft);
    emit("draft.created", { text: draft.text, category: draft.category, claims: draft.claims, quantity: draft.quantity, unclear: draft.unclear }, { buyerId, draftId: draft.id });
    return json(res, 200, { draft });
  }
  const confirm = url.pathname.match(/^\/v1\/drafts\/([^/]+)\/confirm$/);
  if (req.method === "POST" && confirm) {
    await later(900);
    emit("draft.confirmed", {}, { draftId: confirm[1] });
    return json(res, 200, { draft: { ...drafts.get(confirm[1]), status: "confirmed" } });
  }
  if (req.method === "POST" && url.pathname === "/v1/quotes") {
    const { draftId } = await body(req);
    const draft = drafts.get(draftId);
    if (!draft) return json(res, 404, { error: "unknown draft" });
    await later(1800);
    emit("search.done", { count: 35, categories: ["10400"] }, { draftId });
    await later(1200);
    emit("valio.called", { endpoint: "availability", ids: 35, replay: true }, { draftId });
    await later(1800);
    const units = draft.quantity.value;
    const quote = { id: `qte_${++ids}`, draftId, offers: [{ offerId: `of_${ids}`, lines: [{ productId: "464306", salesUnits: units }], netCents: units * CENTS_PER_L, changes: [] }], rejections: [{ productId: "463038", code: "CUTOFF_PASSED" }, { productId: "469363", code: "STOCK_LIMITED", remaining: 384 }] };
    quotes.set(quote.id, quote);
    emit("quote.created", { offers: quote.offers, rejections: quote.rejections }, { draftId, quoteId: quote.id });
    return json(res, 200, { quote });
  }
  if (req.method === "POST" && url.pathname === "/v1/orders") {
    const { quoteId } = await body(req);
    const quote = quotes.get(quoteId);
    if (!quote) return json(res, 404, { error: "unknown quote" });
    await later(1500);
    const cents = quote.offers[0].netCents;
    const outcome = cents <= 50000 ? "AUTO" : cents <= 500000 ? "NEEDS_APPROVAL" : "REJECT";
    const reasons = outcome === "AUTO" ? [] : [{ code: outcome === "REJECT" ? "OVER_ORDER_HARD" : "OVER_ORDER_AUTO" }];
    const orderId = `ord_${++ids}`;
    emit("policy.decided", { outcome, reasons }, { quoteId, orderId });
    if (outcome === "AUTO") {
      await later(800);
      emit("order.accepted", { lines: quote.offers[0].lines, netCents: cents }, { quoteId, orderId });
    }
    if (outcome === "NEEDS_APPROVAL") {
      emit("approval.requested", { orderId, expiresAt: "2026-11-15T17:00:00+02:00" }, { quoteId, orderId });
      setTimeout(() => {
        emit("approval.approved", {}, { orderId });
        setTimeout(() => emit("order.accepted", { lines: quote.offers[0].lines, netCents: cents }, { orderId }), 1200);
      }, 5000);
    }
    return json(res, 200, { orderId, state: outcome === "AUTO" ? "ACCEPTED" : outcome === "REJECT" ? "REJECTED" : "HELD" });
  }
  return json(res, 404, { error: "not found" });
}

/**
 * Reads a single `Range: bytes=a-b` header (also `a-` and the suffix form `-n`) against a file of `size` bytes.
 * Returns null when there is no usable header (serve the whole file), "unsatisfiable" when the range starts past
 * the end, else the inclusive byte span. Browsers need 206 replies to seek inside an audio clip.
 */
function byteRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!m || (m[1] === "" && m[2] === "")) return null;
  const start = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  return start >= size || start > end ? "unsatisfiable" : { start, end };
}

/** The door's public read routes the Inside tab checks; with --door they are fetched from the real door, server side. */
const DOOR_PATHS = new Set(["/v1/rules", "/v1/reason-codes", "/v1/audit/verify", "/.well-known/jwks.json", "/.well-known/agent-gateway.json", "/openapi.json"]);

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "GET" && DOOR_PATHS.has(url.pathname) && option("--door")) {
    try {
      const upstream = await fetch(`${option("--door").replace(/\/+$/, "")}${url.pathname}`, { headers: { accept: "application/json" } });
      res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json", "access-control-allow-origin": "*" });
      return res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      return json(res, 502, { error: "door unreachable", detail: error.message });
    }
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, idempotency-key, accept", "access-control-allow-methods": "GET, POST" });
    return res.end();
  }
  if (url.pathname.startsWith("/v1/")) return api(req, res, url);
  const path = normalize(join(ROOT, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)));
  if (!path.startsWith(ROOT)) return json(res, 403, { error: "forbidden" });
  try {
    const file = await readFile(path);
    const head = { "content-type": TYPES[extname(path)] ?? "application/octet-stream", "cache-control": "no-store", "accept-ranges": "bytes" };
    const range = byteRange(req.headers.range, file.length);
    if (range === "unsatisfiable") {
      res.writeHead(416, { ...head, "content-range": `bytes */${file.length}` });
      return res.end();
    }
    if (range) {
      res.writeHead(206, { ...head, "content-range": `bytes ${range.start}-${range.end}/${file.length}`, "content-length": range.end - range.start + 1 });
      return res.end(file.subarray(range.start, range.end + 1));
    }
    res.writeHead(200, { ...head, "content-length": file.length });
    res.end(file);
  } catch {
    json(res, 404, { error: "not found" });
  }
}).listen(PORT, () => console.log(`fake gateway on http://localhost:${PORT}  (demo at /, replay ${arg("--replay") ? "starts when a viewer connects" : "off"})`));

/** Seconds to wait before each replayed event, by type: long enough for the scene to show one step at a time. */
const PACE = { "clock.set": 1.6, "draft.created": 2.2, "draft.confirmed": 1, "search.done": 1.2, "quote.created": 2, "policy.decided": 2, "approval.requested": 2, "approval.approved": 2.4, "approval.expired": 2.4, "order.accepted": 1.6, "stock.denied": 1.4 };
let replaying = false;

/**
 * With --replay <file> (a recorded run: a JSON array or { events }, e.g. ~/junction-2026/.data/story-v2.1-run.json),
 * plays its events into the log in order, paced by PACE (scaled by --pace), starting when the first viewer reads the log.
 */
async function startReplay() {
  if (replaying || !arg("--replay")) return;
  replaying = true;
  const file = option("--replay")?.startsWith("--") || !option("--replay") ? join(ROOT, "fixtures/story-v2.json") : option("--replay");
  const recorded = JSON.parse(await readFile(file, "utf8"));
  const scale = Number(option("--pace")) || 1;
  for (const ev of Array.isArray(recorded) ? recorded : recorded.events) {
    await later((PACE[ev.type] ?? 0.7) * 1000 * scale);
    const { seq, ts, type, data, ...ids } = ev;
    void seq, void ts;
    emit(type, data, ids);
  }
}
