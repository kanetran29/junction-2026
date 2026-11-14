import { test } from "node:test";
import assert from "node:assert/strict";
import { sseFeed, connectLive, readBacklog } from "../live.mjs";

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
  const done = connectLive({ base: "http://nowhere", onEvent() {}, onStatus: (s) => statuses.push(s), fetchImpl, signal: ctl.signal, retryMs: 5 });
  await wait(40);
  ctl.abort();
  await done;
  assert.ok(statuses.includes("down"));
  assert.ok(calls >= 3);
});

test("live: stream unavailable falls back to polling with since, and never sends a key", async () => {
  const seen = [];
  const urls = [];
  const ctl = new AbortController();
  const fetchImpl = async (url, init) => {
    urls.push(String(url));
    assert.equal(init.headers?.Authorization, undefined);
    if (String(url).includes("/stream")) return new Response("no", { status: 404 });
    const since = Number(new URL(url).searchParams.get("since"));
    const events = since < 2 ? [{ seq: 1, type: "a" }, { seq: 2, type: "b" }].filter((e) => e.seq > since) : [];
    return Response.json({ events });
  };
  const statuses = [];
  const done = connectLive({ base: "http://gw", since: 0, onEvent: (e) => seen.push(e.seq), onStatus: (s) => statuses.push(s), fetchImpl, signal: ctl.signal, pollMs: 5 });
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
    assert.ok(String(url).endsWith("/v1/events/stream?since=0"));
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const statuses = [];
  const done = connectLive({ base: "http://gw/", since: 0, onEvent: (e) => seen.push(e.seq), onStatus: (s) => statuses.push(s), fetchImpl, signal: ctl.signal });
  await wait(20);
  ctl.abort();
  await done;
  assert.deepEqual(seen, [7]);
  assert.equal(statuses[1], "streaming");
});

test("backlog: reads every page of the event log without a key and returns the newest seq", async () => {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(String(url));
    assert.equal(init?.headers?.Authorization, undefined);
    const since = Number(new URL(url).searchParams.get("since"));
    const page = since < 500 ? Array.from({ length: 500 }, (_, i) => ({ seq: since + i + 1, type: "x" })) : [{ seq: 501, type: "clock.set" }];
    return Response.json({ events: since > 500 ? [] : page });
  };
  const { events, last } = await readBacklog({ base: "http://gw/", fetchImpl });
  assert.equal(events.length, 501);
  assert.equal(last, 501);
  assert.deepEqual(urls, ["http://gw/v1/events?since=0", "http://gw/v1/events?since=500"]);
});
