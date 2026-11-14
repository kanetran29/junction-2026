import { randomUUID } from 'node:crypto';

type Json = any;

const GATEWAY = (process.env.GATEWAY_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const ADMIN_KEY = process.env.ADMIN_KEY ?? 'dev-admin-key';
const MILK = { category: '10400', claims: ['FREE_FROM_LACTOSE'], deliverBy: '2026-11-16' };
const DEFAULT_RESET = {
  clock: '2026-11-13T21:10:00+02:00',
  replay: 'replies_2026-11-16',
  mandate: { perOrder: { auto: 500, hard: 5000 }, perDay: { auto: 500, hard: 10000 }, reliabilityFloor: 0.9, approver: 'Kitchen manager', reliabilityUnknown: 'allow' },
};

/** One HTTP call to the gateway as any client: the parsed JSON reply with `httpStatus` added. */
async function http(path: string, o: { key?: string; body?: Json; headers?: Record<string, string>; method?: string } = {}): Promise<Json> {
  const res = await fetch(GATEWAY + path, {
    method: o.method ?? (o.body === undefined ? 'GET' : 'POST'),
    headers: { ...(o.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(o.key ? { Authorization: `Bearer ${o.key}` } : {}), ...o.headers },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  const text = await res.text();
  try {
    return { ...JSON.parse(text), httpStatus: res.status };
  } catch {
    return { text, httpStatus: res.status };
  }
}

/** A buyer's view of the gateway after a reset: its own agent key, plus the human's approver key for the approve steps. */
interface Session {
  agent: Record<string, string>;
  approver: Record<string, string>;
}

/** Resets the demo state (overrides merged over the defaults) and returns the minted keys. */
async function reset(overrides: Json = {}): Promise<Session> {
  const r = await http('/admin/reset', { key: ADMIN_KEY, body: { ...DEFAULT_RESET, ...overrides } });
  if (!r.agentKeys) throw new Error(`reset failed: HTTP ${r.httpStatus}`);
  return { agent: r.agentKeys, approver: r.approverKeys };
}

/** Quotes a draft as an agent. */
const quote = (s: Session, draft: Json, buyer = 'hotel-a') => http('/v1/quotes', { key: s.agent[buyer], body: { draft } });

/** Places an offer of a quote as an agent, with an Idempotency-Key (fresh unless given). */
const place = (s: Session, q: Json, offer = 0, o: { key?: string; buyer?: string; reason?: string } = {}) =>
  http('/v1/orders', { key: s.agent[o.buyer ?? 'hotel-a'], body: { quoteId: q.id, offerId: q.offers?.[offer]?.offerId, agentReason: o.reason }, headers: { 'Idempotency-Key': o.key ?? randomUUID() } });

/** The approval token of an order, read from the human's approver inbox (the agent never sees it). */
async function tokenOf(s: Session, orderId: string, buyer = 'hotel-a'): Promise<string> {
  const inbox = await http(`/approver/${s.approver[buyer]}`, { headers: { Accept: 'application/json' } });
  const hit = (inbox.pending ?? []).find((p: Json) => p.orderId === orderId);
  if (!hit) throw new Error(`order ${orderId} is not in the approver inbox`);
  return hit.token;
}

/** The human approves a HELD order (no agent key on the request). */
async function approve(s: Session, orderId: string): Promise<Json> {
  return http(`/approve/${await tokenOf(s, orderId)}`, { method: 'POST' });
}

const codes = (r: Json): string[] => (r.decision?.reasons ?? []).map((x: Json) => x.code);
const rejection = (q: Json, productId: string) => (q.rejections ?? []).find((x: Json) => x.productId === productId)?.code;

/** A scenario: its name, what the gateway must do, and a run that returns the failed expectations (none = PASS). */
interface Scenario {
  name: string;
  run: () => Promise<string[]>;
}

/** Collects `[label, ok, got]` checks into the list of failures. */
const check = (rows: [string, boolean, unknown][]): string[] => rows.filter(([, ok]) => !ok).map(([label, , got]) => `${label}, got ${JSON.stringify(got)?.slice(0, 120)}`);

const scenarios: Scenario[] = [
  {
    name: "brief example: 1,000 l lactose-free milk by Monday is quoted at 464306 and held for the kitchen manager, then approved",
    run: async () => {
      const s = await reset();
      const q = await quote(s, { ...MILK, quantity: { value: 1000, unit: 'l' } });
      const held = await place(s, q, 0, { reason: 'Cheapest lactose-free milk that arrives Monday.' });
      const done = held.orderId ? await approve(s, held.orderId) : held;
      return check([
        ['offer 0 is 464306 for 1,010.00', q.offers?.[0]?.lines?.[0]?.productId === '464306' && q.offers[0].netCents === 101000, q.offers?.[0]],
        ['order HELD for OVER_ORDER_AUTO', held.state === 'HELD' && codes(held).includes('OVER_ORDER_AUTO'), [held.state, codes(held)]],
        ['approver is the Kitchen manager', held.approval?.approver === 'Kitchen manager', held.approval],
        ['human approval ACCEPTS', done.state === 'ACCEPTED', done.state],
      ]);
    },
  },
  {
    name: 'bulk 10 l: closed boxes are CUTOFF_PASSED, the 1 l pick is HELD for PACK_SIZE_CHANGED',
    run: async () => {
      const s = await reset();
      const q = await quote(s, { ...MILK, quantity: { value: 1000, unit: 'l' }, packLitres: 10 });
      const held = await place(s, q);
      return check([
        ['463038 and 464179 are CUTOFF_PASSED', rejection(q, '463038') === 'CUTOFF_PASSED' && rejection(q, '464179') === 'CUTOFF_PASSED', q.rejections?.slice(0, 4)],
        ['offer 0 is 464306 with PACK_SIZE_CHANGED', q.offers?.[0]?.lines?.[0]?.productId === '464306' && q.offers[0].changes?.includes('PACK_SIZE_CHANGED'), q.offers?.[0]?.changes],
        ['order HELD for PACK_SIZE_CHANGED', held.state === 'HELD' && codes(held).includes('PACK_SIZE_CHANGED'), [held.state, codes(held)]],
      ]);
    },
  },
  {
    name: 'Arla only: stock is limited (435 of 1,000 l), the split offer is HELD for SHORTFALL',
    run: async () => {
      const s = await reset();
      const q = await quote(s, { ...MILK, quantity: { value: 1000, unit: 'l' }, brand: { rule: 'only', names: ['Arla'] } });
      const held = await place(s, q);
      const ids = (q.offers?.[0]?.lines ?? []).map((l: Json) => l.productId);
      return check([
        ['464306 is BRAND_EXCLUDED', rejection(q, '464306') === 'BRAND_EXCLUDED', rejection(q, '464306')],
        ['offer 0 splits 462775 + 469363', ids.includes('462775') && ids.includes('469363'), ids],
        ['filled 435, shortfall 565', q.offers?.[0]?.filled === 435 && q.offers[0].shortfall === 565, [q.offers?.[0]?.filled, q.offers?.[0]?.shortfall]],
        ['order HELD for SHORTFALL', held.state === 'HELD' && codes(held).includes('SHORTFALL'), [held.state, codes(held)]],
      ]);
    },
  },
  {
    name: 'chicken breast 150 kg: cheapest total is 472673 at 1,155.00 (estimate), the 154 kg lot offer costs more, HELD',
    run: async () => {
      const s = await reset();
      const q = await quote(s, { category: '18750', subtype: 'chicken breast fillet', claims: [], quantity: { value: 150, unit: 'kg' }, deliverBy: '2026-11-16' });
      const held = await place(s, q);
      const o = q.offers?.[0];
      const other = (q.offers ?? []).find((x: Json) => x.lines?.[0]?.productId === '462281');
      return check([
        ['offer 0 is 472673, 150 kg, 1,155.00, an estimate', o?.lines?.[0]?.productId === '472673' && o.filled === 150 && o.netCents === 115500 && o.estimate === true, o && [o.lines?.[0]?.productId, o.filled, o.netCents, o.estimate]],
        ['462281 is quoted at 154 kg for 1,185.80', other?.filled === 154 && other.netCents === 118580, other && [other.filled, other.netCents]],
        ['order HELD for OVER_ORDER_AUTO', held.state === 'HELD' && codes(held).includes('OVER_ORDER_AUTO'), [held.state, codes(held)]],
      ]);
    },
  },
  {
    name: 'attack: 1,000 l split 334 + 333 + 333 l, the second order is HELD for OVER_DAY_AUTO',
    run: async () => {
      const s = await reset();
      const placed: Json[] = [];
      for (const litres of [334, 333, 333]) placed.push(await place(s, await quote(s, { ...MILK, quantity: { value: litres, unit: 'l' } })));
      return check([
        ['first order (334 l) ACCEPTED', placed[0].state === 'ACCEPTED', placed[0].state],
        ['second order HELD for OVER_DAY_AUTO', placed[1].state === 'HELD' && codes(placed[1]).includes('OVER_DAY_AUTO'), [placed[1].state, codes(placed[1])]],
        ['third order not auto-accepted either', placed[2].state !== 'ACCEPTED', placed[2].state],
      ]);
    },
  },
  {
    name: 'attack: the agent calls approve with its own key and gets 403, the order stays HELD',
    run: async () => {
      const s = await reset();
      const held = await place(s, await quote(s, { ...MILK, quantity: { value: 1000, unit: 'l' } }));
      const refused = await http(`/approve/${await tokenOf(s, held.orderId)}`, { method: 'POST', key: s.agent['hotel-a'] });
      const after = await http(`/v1/orders/${held.orderId}`, { key: s.agent['hotel-a'] });
      return check([
        ['approve with the agent key is 403', refused.httpStatus === 403, refused.httpStatus],
        ['order is still HELD', after.state === 'HELD', after.state],
      ]);
    },
  },
  {
    name: 'attack: two agents race for 6 units of 470746, one is ACCEPTED, the other gets STOCK_TAKEN',
    run: async () => {
      const s = await reset();
      const draft = { referenceProduct: '470746', quantity: { value: 20, unit: 'kg' }, deliverBy: '2026-11-16', allowSubstitutes: false };
      const buyers = ['hotel-a', 'hotel-b'];
      const quotes = await Promise.all(buyers.map((b) => quote(s, draft, b)));
      const replies = await Promise.all(buyers.map((b, i) => place(s, quotes[i], 0, { buyer: b })));
      const lost = replies.find((r) => r.state === 'REJECTED');
      return check([
        ['one ACCEPTED, one REJECTED', replies.some((r) => r.state === 'ACCEPTED') && Boolean(lost), replies.map((r) => r.state)],
        ['the loser gets STOCK_TAKEN', Boolean(lost && codes(lost).includes('STOCK_TAKEN')), lost && codes(lost)],
      ]);
    },
  },
  {
    name: 'attack: "1000" pieces of a litre-sold milk is not guessed (NOT_CONVERTIBLE, no offer)',
    run: async () => {
      const s = await reset();
      const q = await quote(s, { ...MILK, quantity: { value: 1000, unit: 'pcs' } });
      return check([
        ['no offers', (q.offers ?? []).length === 0, q.offers?.length],
        ['464306 is NOT_CONVERTIBLE', rejection(q, '464306') === 'NOT_CONVERTIBLE', rejection(q, '464306')],
      ]);
    },
  },
  {
    name: 'attack: the official substitute that adds wheat to a gluten-free oat drink is refused (NEW_ALLERGEN)',
    run: async () => {
      const s = await reset({ replayVariant: { '468465': 'out_of_stock' } });
      const q = await quote(s, { referenceProduct: '468465', quantity: { value: 50, unit: 'l' }, deliverBy: '2026-11-16', allowSubstitutes: true });
      return check([
        ['470863 is NEW_ALLERGEN', rejection(q, '470863') === 'NEW_ALLERGEN', rejection(q, '470863')],
        ['470863 is in no offer', !(q.offers ?? []).some((o: Json) => o.lines?.some((l: Json) => l.productId === '470863')), q.offers?.length],
      ]);
    },
  },
  {
    name: 'attack: approval after the 17:05 cut-off expires and places nothing',
    run: async () => {
      const s = await reset();
      const held = await place(s, await quote(s, { ...MILK, quantity: { value: 1000, unit: 'l' } }));
      const token = await tokenOf(s, held.orderId);
      await http('/admin/clock', { key: ADMIN_KEY, body: { clock: '2026-11-15T17:05:00+02:00' } });
      const late = await http(`/approve/${token}`, { method: 'POST' });
      const after = await http(`/v1/orders/${held.orderId}`, { key: s.agent['hotel-a'] });
      return check([
        ['late approval is EXPIRED / APPROVAL_EXPIRED', late.state === 'EXPIRED' && late.reason === 'APPROVAL_EXPIRED', [late.state, late.reason]],
        ['the order reads EXPIRED', after.state === 'EXPIRED', after.state],
      ]);
    },
  },
  {
    name: 'attack: a repeated order with the same Idempotency-Key returns the same order and makes one',
    run: async () => {
      const s = await reset();
      const q = await quote(s, { ...MILK, quantity: { value: 20, unit: 'l' } });
      const key = `demo-${randomUUID()}`;
      const a = await place(s, q, 0, { key });
      const b = await place(s, q, 0, { key });
      const count = (await http(`/admin/orders?idempotencyKey=${key}`, { key: ADMIN_KEY })).count;
      return check([
        ['same order id', Boolean(a.orderId) && a.orderId === b.orderId, [a.orderId, b.orderId]],
        ['exactly one stored order', count === 1, count],
      ]);
    },
  },
];

/** Runs every scenario against the gateway, prints PASS/FAIL per scenario and exits non-zero when any fails. */
async function main(): Promise<void> {
  const health = await http('/health').catch(() => null);
  if (!health?.ok) {
    console.error(`gateway not reachable at ${GATEWAY}`);
    process.exit(1);
  }
  let failed = 0;
  for (const sc of scenarios) {
    let fails: string[];
    try {
      fails = await sc.run();
    } catch (err) {
      fails = [`error: ${(err as Error).message}`];
    }
    if (fails.length) failed++;
    console.log(`${fails.length ? 'FAIL' : 'PASS'}  ${sc.name}${fails.map((f) => `\n        expected ${f}`).join('')}`);
  }
  console.log(`\n${scenarios.length - failed} PASS, ${failed} FAIL of ${scenarios.length}`);
  process.exit(failed ? 1 : 0);
}

await main();
