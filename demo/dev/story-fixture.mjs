// Writes demo/fixtures/story-v2.json from a recorded run of the v2.1 chain on the live door (SCRIPT.md 14.6), keeping only
// what the Story shows: event types, ids, states, reason codes, amounts, counts. Candidate id lists, product names, other
// offers' contents and every raw Valio response stay out of the repo.
// Usage: node demo/dev/story-fixture.mjs [~/junction-2026/.data/story-v2.1-run.json]
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const src = process.argv[2] ?? `${homedir()}/junction-2026/.data/story-v2.1-run.json`;
const run = JSON.parse(readFileSync(src, "utf8"));

/** The parts of one event's data that reach the screen (ticker, cards, racks, stamps, gauge). */
function keep(type, d) {
  switch (type) {
    case "clock.set": return { now: d.now };
    case "draft.created": return { text: d.text, category: d.category, claims: d.claims, quantity: d.quantity, unclear: d.unclear, crossCheck: d.crossCheck };
    case "search.done": return { count: d.count, categories: d.categories };
    case "valio.called": return { endpoint: d.endpoint, ids: Array.isArray(d.ids) ? d.ids.length : d.ids, replay: d.replay };
    case "quote.created": return {
      offers: (d.offers ?? []).map((o, i) => (i === 0 ? { offerId: o.offerId, lines: o.lines.map((l) => ({ productId: l.productId, salesUnits: l.salesUnits })), netCents: o.netCents, changes: o.changes } : { offerId: o.offerId })),
      rejections: (d.rejections ?? []).map((r) => ({ productId: r.productId, code: r.code })),
    };
    case "order.accepted": return { lines: d.lines.map((l) => ({ productId: l.productId, salesUnits: l.salesUnits })), netCents: d.netCents };
    default: return d;
  }
}

const events = run.events.map((ev) => {
  const out = { seq: ev.seq, ts: ev.ts, type: ev.type, buyerId: ev.buyerId };
  for (const id of ["draftId", "quoteId", "orderId"]) if (ev[id]) out[id] = ev[id];
  out.data = keep(ev.type, ev.data ?? {});
  return out;
});
const fixture = {
  source: `The v2.1 chain run once on the live door (${run.reset?.clock}, replay ${run.reset?.replay}, mandate 500 € an order and 1,500 € a day); gateway events only, trimmed to what the Story shows.`,
  events,
};
writeFileSync(new URL("../fixtures/story-v2.json", import.meta.url), JSON.stringify(fixture, null, 1) + "\n");
console.log(`${events.length} events written`);
