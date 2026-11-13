// Live event sources: the gateway's SSE stream (polling fallback), a recorded event file, and the judge's request box.

const trim = (base) => String(base || "").replace(/\/+$/, "");
const authOf = (key) => (key ? { Authorization: `Bearer ${key}` } : {});

/** Resolves after ms, or at once when the signal aborts. */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
}

/** A stateful SSE parser: feed it text chunks, get back the JSON events completed so far. */
export function sseFeed() {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.replace(/\r\n?/g, "\n");
    const frames = buffer.split("\n\n");
    buffer = frames.pop();
    const out = [];
    for (const frame of frames) {
      const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
      if (!data) continue;
      try {
        out.push(JSON.parse(data));
      } catch {
        // ponytail: a frame that is not JSON is skipped silently; log it here if the gateway ever sends text frames.
      }
    }
    return out;
  };
}

/**
 * Follows the gateway's events for one buyer until the signal aborts: SSE first, polling when the stream is
 * unavailable, exponential retry while the gateway is down. Each seq is passed on once. Never rejects.
 */
export async function connectLive({ base, key, buyer = "", since = 0, onEvent, onStatus = () => {}, fetchImpl = fetch, signal, pollMs = 1500, retryMs = 2000 }) {
  let last = since;
  let tryStream = true;
  let delay = retryMs;
  const headers = authOf(key);
  const url = (path) => `${trim(base)}${path}?buyer=${encodeURIComponent(buyer)}&since=${last}`;
  const emit = (ev) => {
    if (!ev || typeof ev !== "object") return;
    if (typeof ev.seq === "number") {
      if (ev.seq <= last) return;
      last = ev.seq;
    }
    onEvent(ev);
  };
  onStatus("connecting");
  while (!signal?.aborted) {
    try {
      if (tryStream) {
        const res = await fetchImpl(url("/v1/events/stream"), { headers: { ...headers, Accept: "text/event-stream" }, signal });
        if (res.ok && res.body && (res.headers.get("content-type") || "").includes("event-stream")) {
          onStatus("streaming");
          delay = retryMs;
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          const stop = () => reader.cancel().catch(() => {});
          signal?.addEventListener("abort", stop, { once: true });
          const feed = sseFeed();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            feed(value).forEach(emit);
          }
          signal?.removeEventListener("abort", stop);
          continue;
        }
        tryStream = false;
      }
      const res = await fetchImpl(url("/v1/events"), { headers, signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      onStatus("polling");
      delay = retryMs;
      (Array.isArray(body) ? body : body?.events ?? []).forEach(emit);
      await sleep(pollMs, signal);
    } catch (error) {
      if (signal?.aborted) break;
      onStatus("down", error?.message ?? String(error));
      await sleep(delay, signal);
      delay = Math.min(delay * 2, 10000);
      tryStream = true;
    }
  }
}

/** Plays a recorded event file (a JSON array, or { events }) with its own timing, gaps capped at maxGap seconds. */
export async function replayFile({ url, onEvent, onStatus = () => {}, signal, speed = 1, maxGap = 2.5, fetchImpl = fetch }) {
  try {
    const res = await fetchImpl(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const events = Array.isArray(body) ? body : body?.events ?? [];
    onStatus("replaying");
    let prev = null;
    for (const ev of events) {
      const at = Date.parse(ev.ts);
      const gap = prev === null || Number.isNaN(at) ? 0 : Math.min(Math.max(0, (at - prev) / 1000), maxGap);
      prev = Number.isNaN(at) ? prev : at;
      await sleep((gap * 1000) / speed, signal);
      if (signal?.aborted) return;
      onEvent(ev);
    }
    onStatus("ended");
  } catch (error) {
    if (!signal?.aborted) onStatus("down", error?.message ?? String(error));
  }
}

/**
 * Sends a judge's sentence through the normal flow as a minimal agent: interpret, confirm, quote, order offer 0.
 * The gateway decides everything and its events animate the scene. Returns { ok, step, error?, order? }.
 */
export async function sendRequest({ base, key, buyer, text, fetchImpl = fetch }) {
  const call = async (step, path, body, extra = {}) => {
    const res = await fetchImpl(`${trim(base)}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...authOf(key), ...extra }, body: JSON.stringify(body) });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) throw Object.assign(new Error(`${res.status} ${json?.error?.message ?? json?.error ?? res.statusText ?? ""}`.trim()), { step });
    return json ?? {};
  };
  let step = "interpret";
  try {
    const interpreted = await call(step, "/v1/interpret", { buyerId: buyer, text });
    const draft = interpreted.draft ?? interpreted;
    const draftId = draft.id ?? draft.draftId ?? interpreted.draftId;
    const unclear = draft.unclear ?? interpreted.unclear ?? [];
    if (unclear.length) return { ok: false, step, error: `the door needs: ${unclear.join(", ")}` };
    step = "confirm";
    await call(step, `/v1/drafts/${encodeURIComponent(draftId)}/confirm`, { fill: {} });
    step = "quote";
    const quoted = await call(step, "/v1/quotes", { draftId });
    const quote = quoted.quote ?? quoted;
    const offer = quote.offers?.[0];
    if (!offer) return { ok: false, step, error: `no offer: ${(quote.rejections ?? []).map((r) => r.code).join(", ") || "none feasible"}` };
    step = "order";
    const order = await call(step, "/v1/orders", { quoteId: quote.id ?? quote.quoteId, offerId: offer.offerId, agentReason: "Request typed on the demo page." }, { "Idempotency-Key": crypto.randomUUID() });
    return { ok: true, step, order };
  } catch (error) {
    return { ok: false, step: error.step ?? step, error: error.message };
  }
}
