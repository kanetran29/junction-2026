// Live mode's link to the door: its public event log (no key, every buyer), read once for the backlog, then followed live.

const trim = (base) => String(base || "").replace(/\/+$/, "");

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
 * Reads the door's whole event log once, page by page (oldest first, at most 500 per call), without a key: the door
 * opens it to viewers in demo mode. Returns { events, last }, the events and the highest seq seen.
 */
export async function readBacklog({ base, fetchImpl = fetch, signal }) {
  const events = [];
  let last = 0;
  for (;;) {
    const res = await fetchImpl(`${trim(base)}/v1/events?since=${last}`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const page = Array.isArray(body) ? body : body?.events ?? [];
    for (const ev of page) {
      if (typeof ev?.seq !== "number" || ev.seq <= last) continue;
      events.push(ev);
      last = ev.seq;
    }
    if (page.length < 500) return { events, last };
  }
}

/**
 * Follows the door's events (every buyer, no key) after seq `since` until the signal aborts: SSE first, polling when
 * the stream is unavailable, exponential retry while the door is down. Each seq is passed on once. Never rejects.
 */
export async function connectLive({ base, since = 0, onEvent, onStatus = () => {}, fetchImpl = fetch, signal, pollMs = 1500, retryMs = 2000 }) {
  let last = since;
  let tryStream = true;
  let delay = retryMs;
  const url = (path) => `${trim(base)}${path}?since=${last}`;
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
        const res = await fetchImpl(url("/v1/events/stream"), { headers: { Accept: "text/event-stream" }, signal });
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
      const res = await fetchImpl(url("/v1/events"), { signal });
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
