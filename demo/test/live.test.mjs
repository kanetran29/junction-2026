import { test } from "node:test";
import assert from "node:assert/strict";
import { sseFeed, connectLive, sendRequest } from "../live.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("sse: frame split across chunks", () => {
  const feed = sseFeed();
  assert.deepEqual(feed(': hello\n\nid: 1\ndata: {"seq":1,"ty'), []);
  const out = feed('pe":"draft.created"}\n\ndata: not json\n\ndata: {"seq":2,"type":"x"}\r\n\r\n');
  assert.deepEqual(out.map((e) => e.seq), [1, 2]);
});

test("sse: multi-line data joins with newlines", () => {
  const feed = sseFeed();
  assert.deepEqual(feed('data: {"seq":3,\ndata: "type":"y"}\n\n')[0], { seq: 3, type: "y" });
});

test("live: fetch failure reports down, then retries without throwing", async () => {
  const statuses = [];
  let calls = 0;
  const ctl = new AbortController();
  const fetchImpl = async () => { calls += 1; throw new TypeError("Failed to fetch"); };
  const done = connectLive({ base: "http://nowhere", key: "k", buyer: "b", onEvent() {}, onStatus: (s) => statuses.push(s), fetchImpl, signal: ctl.signal, retryMs: 5 });
  await wait(40);
  ctl.abort();
  await done;
  assert.ok(statuses.includes("down"));
  assert.ok(calls >= 3);
});

test("live: stream unavailable falls back to polling with since and bearer key", async () => {
  const seen = [];
  const urls = [];
  const ctl = new AbortController();
  const fetchImpl = async (url, init) => {
    urls.push(String(url));
    assert.equal(init.headers.Authorization, "Bearer k1");
    if (String(url).includes("/stream")) return new Response("no", { status: 404 });
    const since = Number(new URL(url).searchParams.get("since"));
    const events = since < 2 ? [{ seq: 1, type: "a" }, { seq: 2, type: "b" }].filter((e) => e.seq > since) : [];
    return Response.json({ events });
  };
  const statuses = [];
  const done = connectLive({ base: "http://gw", key: "k1", buyer: "hotel", since: 0, onEvent: (e) => seen.push(e.seq), onStatus: (s) => statuses.push(s), fetchImpl, signal: ctl.signal, pollMs: 5 });
  await wait(40);
  ctl.abort();
  await done;
  assert.deepEqual(seen, [1, 2]);
  assert.ok(statuses.includes("polling"));
  assert.ok(urls.some((u) => u.includes("since=2")));
});

test("live: streams SSE events", async () => {
  const seen = [];
  const ctl = new AbortController();
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('data: {"seq":7,"type":"clock.set"}\n\n'));
    },
  });
  const fetchImpl = async (url) => {
    assert.ok(String(url).includes("/v1/events/stream?buyer=hotel&since=0"));
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const statuses = [];
  const done = connectLive({ base: "http://gw/", key: "k", buyer: "hotel", since: 0, onEvent: (e) => seen.push(e.seq), onStatus: (s) => statuses.push(s), fetchImpl, signal: ctl.signal });
  await wait(20);
  ctl.abort();
  await done;
  assert.deepEqual(seen, [7]);
  assert.equal(statuses[1], "streaming");
});

test("request: stops at an unclear draft and reports it", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([init.method, new URL(url).pathname]);
    return Response.json({ draftId: "drf_1", draft: { unclear: ["quantity"] } });
  };
  const out = await sendRequest({ base: "http://gw", key: "k", buyer: "hotel", text: "milk", fetchImpl });
  assert.equal(out.ok, false);
  assert.equal(out.step, "interpret");
  assert.match(out.error, /quantity/);
  assert.deepEqual(calls, [["POST", "/v1/interpret"]]);
});

test("request: runs interpret, confirm, quote and order", async () => {
  const paths = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    paths.push(path);
    if (path === "/v1/interpret") return Response.json({ draft: { id: "drf_9", unclear: [] } });
    if (path === "/v1/quotes") return Response.json({ quoteId: "qte_9", offers: [{ offerId: "of_a" }] });
    if (path === "/v1/orders") {
      assert.ok(init.headers["Idempotency-Key"]);
      assert.equal(JSON.parse(init.body).offerId, "of_a");
      return Response.json({ orderId: "ord_9", state: "HELD" });
    }
    return Response.json({});
  };
  const out = await sendRequest({ base: "http://gw", key: "k", buyer: "hotel", text: "1,000 l lactose-free milk by Monday", fetchImpl });
  assert.equal(out.ok, true);
  assert.deepEqual(paths, ["/v1/interpret", "/v1/drafts/drf_9/confirm", "/v1/quotes", "/v1/orders"]);
});

test("request: gateway error is reported, not thrown", async () => {
  const out = await sendRequest({ base: "http://gw", key: "bad", buyer: "hotel", text: "x", fetchImpl: async () => Response.json({ error: "unauthorized" }, { status: 401 }) });
  assert.deepEqual([out.ok, out.step], [false, "interpret"]);
  assert.match(out.error, /401/);
});
