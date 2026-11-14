// Development stand-in for the Lazydoor gateway: serves demo/ and the event endpoints from the docs/events.md schema.
// Run: node demo/dev/fake-gateway.mjs [--port 8790] [--no-sse] [--story]
//   --no-sse  the stream endpoint answers 404, so the page falls back to polling
//   --story   replays the story's gateway events once, paced, right after start
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gatewayEvents } from "../story.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => process.argv.includes(name);
const PORT = Number(process.argv[process.argv.indexOf("--port") + 1]) || 8790;
const TYPES = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".svg": "image/svg+xml" };
const events = [];
const listeners = new Set();
const CENTS_PER_L = 101;
let ids = 0;

/** Appends an event to the log and pushes it to every open stream. */
function emit(type, data, extra = {}) {
  const ev = { seq: events.length + 1, ts: new Date().toISOString(), type, buyerId: extra.buyerId ?? "hotel-aurora", ...extra, data };
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

async function api(req, res, url) {
  const buyerId = url.searchParams.get("buyer") || "hotel-aurora";
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

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
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
}).listen(PORT, () => console.log(`fake gateway on http://localhost:${PORT}  (demo at /, story events ${arg("--story") ? "replaying" : "off"})`));

if (arg("--story")) {
  (async () => {
    let prev = null;
    for (const ev of gatewayEvents()) {
      const at = Date.parse(ev.ts);
      await later(prev === null ? 1500 : Math.min(2500, at - prev));
      prev = at;
      const { seq, ts, type, data, ...ids } = ev;
      void seq, void ts;
      emit(type, data, ids);
    }
  })();
}
