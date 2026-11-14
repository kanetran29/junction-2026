#!/usr/bin/env node
// A light load test of the demo door from one machine (no browsers): Live viewers on the keyless event stream, Try it runs
// with the page's example sentences from fresh visitors, a few free-text tries, and approve/reject decisions. Prints
// p50/p95/max latency and the status codes per route. Needs nothing but Node.
// Usage: node scripts/load-test.mjs [door URL] [--viewers 100] [--minutes 3] [--tries-per-minute 30] [--free 5] [--decisions 20]
const args = process.argv.slice(2);
/** The value after a --flag, as a number, or the default. */
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args.splice(i, 2)[1]) : dflt;
};
const viewers = opt('viewers', 100);
const minutes = opt('minutes', 3);
const triesPerMinute = opt('tries-per-minute', 30);
let freeLeft = opt('free', 5);
let decisionsLeft = opt('decisions', 20);
const door = (args[0] ?? 'https://lazydoor.lazydoor.workers.dev').replace(/\/$/, '');
const EXAMPLES = ['1,000 litres of lactose-free milk by Monday', '20 kg of chicken breast fillet by Monday', '40 kg of chicken breast fillet for Friday, Atria only', '50 litres of gluten-free oat drink by Monday'];
const FREE = ['12 litres of lactose-free milk by Monday', '8 kg of butter by Monday', '30 litres of oat drink by Monday', '15 kg of chicken breast fillet by Monday', '25 litres of semi-skimmed milk by Monday'];
const end = Date.now() + minutes * 60_000;
const samples = new Map();

/** Records one call's latency and outcome under a route name. */
function record(route, ms, outcome) {
  const s = samples.get(route) ?? { ms: [], outcomes: {} };
  s.ms.push(ms);
  s.outcomes[outcome] = (s.outcomes[outcome] ?? 0) + 1;
  samples.set(route, s);
}

/** POSTs JSON and records latency and `status code` (or the network error) under `route`. */
async function post(route, path, body) {
  const t = performance.now();
  try {
    const res = await fetch(door + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    record(route, performance.now() - t, `${res.status}${json.error ? ` ${json.error}` : ''}`);
    return { status: res.status, body: json };
  } catch (err) {
    record(route, performance.now() - t, `network ${err.cause?.code ?? err.name}`);
    return { status: 0, body: {} };
  }
}

/** One Live viewer: the backlog once, then the keyless stream, reconnecting with Last-Event-ID until the run ends. */
async function viewer() {
  let since = 0;
  const t0 = performance.now();
  try {
    const res = await fetch(`${door}/v1/events?since=0`);
    const page = await res.json();
    since = page.next ?? 0;
    record('GET /v1/events (backlog)', performance.now() - t0, String(res.status));
  } catch (err) {
    record('GET /v1/events (backlog)', performance.now() - t0, `network ${err.cause?.code ?? err.name}`);
  }
  while (Date.now() < end) {
    const t = performance.now();
    const ctl = new AbortController();
    const stop = setTimeout(() => ctl.abort(), Math.max(1, end - Date.now()));
    try {
      const res = await fetch(`${door}/v1/events/stream?since=${since}`, { signal: ctl.signal, headers: { Accept: 'text/event-stream' } });
      record('GET /v1/events/stream (open)', performance.now() - t, String(res.status));
      if (!res.ok) {
        await res.body?.cancel();
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      const dec = new TextDecoder();
      let buf = '';
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        for (const m of buf.matchAll(/^id: (\d+)$/gm)) since = Math.max(since, Number(m[1]));
        buf = buf.slice(buf.lastIndexOf('\n\n') + 1);
      }
    } catch (err) {
      if (err.name !== 'AbortError') record('GET /v1/events/stream (open)', performance.now() - t, `network ${err.cause?.code ?? err.name}`);
    } finally {
      clearTimeout(stop);
    }
  }
}

/** One Try it run with an example sentence from a fresh visitor; a held order is decided while decisions remain. */
async function chipRun(i) {
  const r = await post('POST /v1/try (example)', '/v1/try', { text: EXAMPLES[i % EXAMPLES.length] });
  if (r.body.approval?.token && decisionsLeft > 0) {
    decisionsLeft--;
    await post('POST /v1/try/decision', '/v1/try/decision', { visitor: r.body.visitor, token: r.body.approval.token, decision: decisionsLeft % 2 ? 'approve' : 'reject' });
  }
}

/** Free-text tries, spread over the run. */
async function freeRuns() {
  const total = freeLeft;
  for (let i = 0; i < total && Date.now() < end; i++) {
    await post('POST /v1/try (free text)', '/v1/try', { text: FREE[i % FREE.length] });
    freeLeft--;
    await new Promise((r) => setTimeout(r, (minutes * 60_000) / Math.max(1, total)));
  }
}

/** Example runs at a steady rate until the run ends. */
async function chipRuns() {
  const every = 60_000 / Math.max(1, triesPerMinute);
  const running = [];
  for (let i = 0; Date.now() < end; i++) {
    running.push(chipRun(i));
    await new Promise((r) => setTimeout(r, every));
  }
  await Promise.all(running);
}

/** The p-th percentile of sorted numbers. */
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

console.log(`load test: ${door}, ${viewers} viewers, ${minutes} min, ${triesPerMinute} example tries a minute, ${freeLeft} free-text tries, up to ${decisionsLeft} decisions`);
await Promise.all([...Array.from({ length: viewers }, viewer), triesPerMinute > 0 ? chipRuns() : null, freeLeft > 0 ? freeRuns() : null]);
console.log('\nroute | n | p50 ms | p95 ms | max ms | outcomes');
for (const [route, s] of samples) {
  const ms = s.ms.sort((a, b) => a - b);
  console.log(`${route} | ${ms.length} | ${pct(ms, 50).toFixed(0)} | ${pct(ms, 95).toFixed(0)} | ${ms.at(-1).toFixed(0)} | ${Object.entries(s.outcomes).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
}
