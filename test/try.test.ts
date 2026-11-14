import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertStatements } from '../scripts/build-index';
import { setClock } from '../src/clock';
import { db } from '../src/db';
import type { Env } from '../src/env';
import { listEvents } from '../src/events/log';
import { clearListsCache } from '../src/interpret/gemini';
import { createApp } from '../src/http/routes';
import { sha256Hex } from '../src/util';
import { clearValioBlock } from '../src/valio/client';
import { fakeValio, product } from './quote-helpers';
import { addressBucket } from '../src/try/sandbox';

const e = { ...(env as unknown as Env), DEMO_MODE: '1', VALIO_API_KEY: 'vk', ADMIN_KEY: 'adm', GEMINI_API_KEY: 'gk', GEMINI_MODEL: 'gemini-test', GEMMA_MODEL: 'gemma-test' };
const valio = fakeValio({ P1: { price: 3, stock: 5000 } }).fn;

/** What the stub models read: Gemini's draft, and Gemma's when it should read the sentence differently. */
let gemini: Record<string, unknown>;
let gemma: Record<string, unknown> | undefined;
const draftFor = (litres: number) => ({ category: '10400', claims: ['FREE_FROM_LACTOSE'], quantity: { value: litres, unit: 'l' }, deliverBy: '2026-11-16', unclear: [], needs: ['lactose-free milk'] });
let modelCalls = 0;
let geminiDown = false;

/** Gemini and Gemma answer from the variables above; everything else goes to the fake Valio. */
const upstream = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  if (!u.includes('generativelanguage')) return valio(url, init);
  modelCalls++;
  if (geminiDown) return new Response('quota', { status: 429 });
  const body = u.includes('gemma-test') && gemma ? gemma : gemini;
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }));
}) as typeof fetch;

const app = createApp(upstream);
const json = async (r: Response) => (await r.json()) as any;
/** POSTs JSON to the app from a client address, optionally with a bearer key and another env. */
const post = (path: string, body: unknown, o: { ip?: string; key?: string; env?: Env } = {}) =>
  app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': o.ip ?? '198.51.100.1', ...(o.key ? { Authorization: `Bearer ${o.key}` } : {}) }, body: JSON.stringify(body) }, o.env ?? e);
const tryIt = (body: unknown, o: { ip?: string } = {}) => post('/v1/try', body, o);
const decide = (body: unknown, o: { ip?: string; key?: string } = {}) => post('/v1/try/decision', body, o);

/** A fresh demo door: everything wiped (sandboxes and rate counters too), clock Friday 21:10. */
async function reset(): Promise<{ agentKeys: Record<string, string> }> {
  return json(await app.request('/admin/reset', { method: 'POST', headers: { Authorization: 'Bearer adm', 'Content-Type': 'application/json' }, body: JSON.stringify({ clock: '2026-11-13T21:10:00+02:00', replay: null, replayVariant: {} }) }, e));
}

beforeAll(async () => {
  clearListsCache();
  clearValioBlock();
  await e.DB.batch(insertStatements([product('P1')]).map((s) => e.DB.prepare(s)));
  await e.DB.prepare("INSERT OR REPLACE INTO category_names(category, names, tag_source) VALUES ('10400','Milk','reviewed')").run();
});

beforeEach(async () => {
  await reset();
  gemini = draftFor(20);
  gemma = undefined;
  modelCalls = 0;
  geminiDown = false;
});

describe('POST /v1/try (demo door only, no key)', () => {
  it('runs a small request to an AUTO order in a new sandbox kitchen, logging every step under its buyer', async () => {
    const r = await tryIt({ text: '20 litres of lactose-free milk by Monday' });
    expect(r.status).toBe(200);
    const b = await json(r);
    expect(b).toMatchObject({ visitor: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/), buyerId: expect.stringMatching(/^visitor-[0-9a-f]{8}$/), step: 'decided' });
    expect(b.draft).toMatchObject({ status: 'confirmed', quantity: { value: 20, unit: 'l' } });
    expect(b.quote).toMatchObject({ quoteId: expect.any(String), jws: b.quote.offers[0].jws });
    expect(b.order).toEqual({ orderId: expect.any(String), state: 'ACCEPTED', reasons: [], netCents: 6000, grossCents: expect.any(Number) });
    expect(b.approval).toBeUndefined();
    const types = (await listEvents(e, { since: 0, buyerId: b.buyerId })).map((x) => x.type);
    expect(types).toEqual(expect.arrayContaining(['draft.created', 'draft.confirmed', 'search.done', 'valio.called', 'quote.created', 'policy.decided', 'order.accepted']));
    expect(await db(e).prepare('SELECT 1 AS x FROM try_visitors WHERE token_hash = ?').bind(await sha256Hex(b.visitor)).first()).toEqual({ x: 1 });
    expect(JSON.stringify(b)).not.toContain('"d"');
  });

  it('holds a large order under the kitchen limit, names the visitor as approver, and the visitor approves it', async () => {
    gemini = draftFor(200);
    const b = await json(await tryIt({ text: '200 litres of lactose-free milk by Monday' }));
    expect(b.order).toMatchObject({ state: 'HELD', reasons: [{ code: 'OVER_ORDER_AUTO', detail: expect.any(String) }], netCents: 60000 });
    expect(b.approval).toEqual({ token: expect.any(String), expiresAt: expect.any(String) });
    const pending = await json(await app.request(`/v1/orders/${b.order.orderId}`, {}, e));
    expect(pending.error).toBe('UNAUTHORIZED');
    const d = await json(await decide({ visitor: b.visitor, token: b.approval.token, decision: 'approve' }));
    expect(d).toEqual({ order: { orderId: b.order.orderId, state: 'ACCEPTED', reasons: [{ code: 'OVER_ORDER_AUTO', detail: expect.any(String) }] } });
    const row = await db(e).prepare('SELECT approver FROM orders WHERE id = ?').bind(b.order.orderId).first<{ approver: string }>();
    expect(row!.approver).toBe('You (kitchen manager)');
  });

  it('lets the visitor reject a held order', async () => {
    gemini = draftFor(200);
    const b = await json(await tryIt({ text: '200 litres of lactose-free milk by Monday' }));
    const d = await json(await decide({ visitor: b.visitor, token: b.approval.token, decision: 'reject' }));
    expect(d.order).toMatchObject({ orderId: b.order.orderId, state: 'REJECTED' });
  });

  it('asks the visitor when the two models read the date differently, then goes on from their answer', async () => {
    gemma = { ...draftFor(20), deliverBy: '2026-11-20' };
    const first = await json(await tryIt({ text: '20 litres of lactose-free milk for Friday' }));
    expect(first).toMatchObject({ step: 'needs_input', draft: { status: 'needs_input', missing: ['deliverBy'] }, question: { field: 'deliverBy', readings: [{ model: 'gemini-test', value: '2026-11-16' }, { model: 'gemma-test', value: '2026-11-20' }] } });
    expect(first.order).toBeUndefined();
    const calls = modelCalls;
    const next = await json(await tryIt({ visitor: first.visitor, draftId: first.draft.id, answer: { field: 'deliverBy', value: '2026-11-16' } }));
    expect(next).toMatchObject({ visitor: first.visitor, buyerId: first.buyerId, step: 'decided', draft: { status: 'confirmed', deliverBy: '2026-11-16' }, order: { state: 'ACCEPTED' } });
    expect(modelCalls).toBe(calls);
  });

  it('says no_offer with the rejections when nothing can be ordered', async () => {
    gemini = { ...draftFor(20), deliverBy: '2026-11-14' };
    const b = await json(await tryIt({ text: '20 litres of lactose-free milk by tomorrow' }));
    expect(b.step).toBe('no_offer');
    expect(b.quote.offers).toEqual([]);
    expect(b.quote.rejections.length).toBeGreaterThan(0);
    expect(b.order).toBeUndefined();
  });

  it('refuses text over 200 characters (after trimming), empty text, and an answer for another field', async () => {
    expect((await tryIt({ text: 'x'.repeat(201) })).status).toBe(400);
    expect((await tryIt({ text: '   ' })).status).toBe(400);
    expect((await tryIt({ text: `  ${'x'.repeat(200)}  ` })).status).not.toBe(400);
    expect((await tryIt({ visitor: 'v', draftId: 'd', answer: { field: 'quantity', value: '2026-11-16' } })).status).toBe(400);
    expect((await tryIt({ visitor: 'v', draftId: 'd', answer: { field: 'deliverBy', value: 'Friday' } })).status).toBe(400);
  });

  it('limits each client address to 3 calls a minute and all visitors to 12', async () => {
    for (let i = 0; i < 3; i++) expect((await tryIt({ text: 'milk' }, { ip: '203.0.113.1' })).status).toBe(200);
    const limited = await tryIt({ text: 'milk' }, { ip: '203.0.113.1' });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await json(limited)).toMatchObject({ error: 'TRY_RATE_LIMITED', retryAfter: expect.any(Number) });
    for (let i = 2; i <= 10; i++) expect((await tryIt({ text: 'milk' }, { ip: `203.0.113.${i}` })).status, `ip ${i}`).toBe(200);
    const busy = await tryIt({ text: 'milk' }, { ip: '203.0.113.11' });
    expect(busy.status).toBe(429);
    expect(await json(busy)).toMatchObject({ error: 'TRY_RATE_LIMITED', detail: expect.stringContaining('all visitors') });
  });

  it('opens at most 50 sandboxes; reset ends them all', async () => {
    for (let i = 0; i < 50; i++) await db(e).prepare('INSERT INTO try_visitors(token_hash, buyer_id, address_hash, created_at, last_used) VALUES (?, ?, ?, ?, ?)').bind(`h${i}`, `visitor-${String(i).padStart(8, '0')}`, `a${i}`, 'x', Date.now()).run();
    const full = await tryIt({ text: 'milk' });
    expect(full.status).toBe(429);
    expect(await json(full)).toMatchObject({ error: 'TRY_SANDBOXES_FULL' });
    expect(await db(e).prepare("SELECT COUNT(*) AS n FROM mandates WHERE buyer_id LIKE 'visitor-%'").first()).toEqual({ n: 0 });
    await reset();
    const b = await json(await tryIt({ text: 'milk' }));
    expect(b.step).toBe('decided');
    await reset();
    expect(await json(await tryIt({ visitor: b.visitor, text: 'milk' }))).toMatchObject({ error: 'VISITOR_UNKNOWN' });
  });

  it('is 404 when the door is not a demo door, before any validation', async () => {
    const off = { ...e, DEMO_MODE: '0' };
    for (const [path, body] of [['/v1/try', { text: 'milk' }], ['/v1/try', { text: 'x'.repeat(500) }], ['/v1/try/decision', { visitor: 'v', token: 't', decision: 'approve' }]] as const) {
      expect((await post(path, body, { env: off })).status).toBe(404);
    }
  });
});

describe('Try it stays in its own world and cannot be exhausted by one person', () => {
  it("keeps sandbox orders off the hotels' stock ledger, while visitors still compete with each other", async () => {
    const small = createApp((async (url: string | URL | Request, init?: RequestInit) =>
      String(url).includes('generativelanguage') ? upstream(url, init) : fakeValio({ P1: { price: 3, stock: 30 } }).fn(url, init)) as typeof fetch);
    const call = (path: string, body: unknown, o: { key?: string; ip?: string } = {}) =>
      small.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': o.ip ?? '198.51.100.40', ...(o.key ? { Authorization: `Bearer ${o.key}` } : {}) }, body: JSON.stringify(body) }, e);
    const keys = await reset();
    expect((await json(await call('/v1/try', { text: '20 l milk by Monday' }))).order.state).toBe('ACCEPTED');
    const need = { category: '10400', claims: ['FREE_FROM_LACTOSE'], quantity: { value: 20, unit: 'l' }, deliverBy: '2026-11-16' };
    const q = await json(await call('/v1/quotes', { draft: need }, { key: keys.agentKeys['hotel-a'] }));
    expect(q.offers.map((o: any) => [o.lines[0].productId, o.shortfall])).toEqual([['P1', 0]]);
    const placed = await small.request('/v1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keys.agentKeys['hotel-a']}`, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ quoteId: q.id, offerId: q.offers[0].offerId }) }, e);
    expect((await json(placed)).state).toBe('ACCEPTED');
    const second = await json(await call('/v1/try', { text: '20 l milk by Monday' }, { ip: '198.51.100.41' }));
    expect(second.quote.offers.map((o: any) => [o.lines[0].salesUnits, o.shortfall])).toEqual([[10, 10]]);
  });

  it('frees the sandbox when its first call fails, so failures never fill the 50 slots', async () => {
    geminiDown = true;
    const r = await tryIt({ text: '20 litres of lactose-free milk by Monday' });
    expect(r.status).toBe(503);
    expect(await db(e).prepare('SELECT COUNT(*) AS n FROM try_visitors').first()).toEqual({ n: 0 });
    expect(await db(e).prepare("SELECT COUNT(*) AS n FROM mandates WHERE buyer_id LIKE 'visitor-%'").first()).toEqual({ n: 0 });
  });

  it('counts a call against all visitors only when it is about to ask the models', async () => {
    for (let i = 0; i < 12; i++) expect((await tryIt({ visitor: 'stale', text: 'milk' }, { ip: `192.0.2.${i}` })).status).toBe(404);
    expect((await tryIt({ text: 'milk' }, { ip: '192.0.2.200' })).status).toBe(200);
  });

  it('treats one IPv6 /64 as one address', async () => {
    expect(addressBucket('2001:db8:1:2::1')).toBe(addressBucket('2001:0db8:0001:0002:ffff::9'));
    expect(addressBucket('2001:db8:1:2::1')).not.toBe(addressBucket('2001:db8:1:3::1'));
    expect(addressBucket('203.0.113.9')).toBe('203.0.113.9');
    for (const ip of ['2001:db8:1:2::1', '2001:db8:1:2::2', '2001:db8:1:2::3']) expect((await tryIt({ text: 'milk' }, { ip })).status).toBe(200);
    expect((await tryIt({ text: 'milk' }, { ip: '2001:db8:1:2::4' })).status).toBe(429);
  });

  it('lets one address hold at most 3 open sandboxes, and frees sandboxes idle for 30 minutes', async () => {
    const mine = await sha256Hex(`try-address:${addressBucket('198.51.100.60')}`);
    const fresh = Date.now();
    for (let i = 0; i < 3; i++) await db(e).prepare('INSERT INTO try_visitors(token_hash, buyer_id, address_hash, created_at, last_used) VALUES (?, ?, ?, ?, ?)').bind(`m${i}`, `visitor-m000000${i}`, mine, 'x', fresh).run();
    const full = await tryIt({ text: 'milk' }, { ip: '198.51.100.60' });
    expect(full.status).toBe(429);
    expect(await json(full)).toMatchObject({ error: 'TRY_SANDBOXES_FULL', detail: expect.stringContaining('this address') });
    await db(e).prepare('UPDATE try_visitors SET last_used = ?').bind(fresh - 31 * 60_000).run();
    for (let i = 0; i < 47; i++) await db(e).prepare('INSERT INTO try_visitors(token_hash, buyer_id, address_hash, created_at, last_used) VALUES (?, ?, ?, ?, ?)').bind(`o${i}`, `visitor-o${String(i).padStart(7, '0')}`, `a${i}`, 'x', fresh - 31 * 60_000).run();
    expect((await tryIt({ text: 'milk' }, { ip: '198.51.100.60' })).status).toBe(200);
    expect(await db(e).prepare('SELECT COUNT(*) AS n FROM try_visitors').first()).toEqual({ n: 1 });
  });

  it('asks again when a field is still open after an answer, instead of a dead end', async () => {
    gemini = { ...draftFor(20), quantity: null };
    gemma = { ...draftFor(20), quantity: null, deliverBy: '2026-11-20' };
    const first = await json(await tryIt({ text: 'lactose-free milk for Friday' }));
    expect(first.question.field).toBe('deliverBy');
    const next = await json(await tryIt({ visitor: first.visitor, draftId: first.draft.id, answer: { field: 'deliverBy', value: '2026-11-16' } }));
    expect(next).toMatchObject({ step: 'needs_input', question: { field: 'quantity', readings: [] } });
  });

  it('refuses a body over 4 KB before reading it', async () => {
    const r = await app.request('/v1/try', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.70' }, body: JSON.stringify({ text: 'x', pad: 'y'.repeat(5000) }) }, e);
    expect(r.status).toBe(413);
  });

  it('is not advertised on a door that is not a demo door', async () => {
    const off = { ...e, DEMO_MODE: '0' };
    expect((await json(await app.request('https://door.example/.well-known/agent-gateway.json', {}, off))).tryIt).toBeUndefined();
    expect((await json(await app.request('/v1/rules', {}, off))).decisions.map((d: any) => d.id)).not.toContain('tryIt');
  });
});

describe('Try it is written down', () => {
  it('in /v1/rules, /v1/reason-codes, the discovery document and /openapi.json', async () => {
    const rule = (await json(await app.request('/v1/rules', {}, e))).decisions.find((d: any) => d.id === 'tryIt');
    expect(rule).toMatchObject({ owner: 'seller', model: false, constants: { perAddressPerMinute: 3, allVisitorsPerMinute: 12, maxSandboxes: 50, approver: 'You (kitchen manager)' } });
    const codes = (await json(await app.request('/v1/reason-codes', {}, e))).codes.map((c: any) => c.code);
    expect(codes).toEqual(expect.arrayContaining(['TRY_RATE_LIMITED', 'TRY_SANDBOXES_FULL']));
    const disc = await json(await app.request('https://door.example/.well-known/agent-gateway.json', {}, e));
    expect(disc.tryIt).toMatchObject({ url: 'https://door.example/v1/try', decision: 'https://door.example/v1/try/decision', demoOnly: true });
    const doc = await json(await app.request('/openapi.json', {}, e));
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/v1/try', '/v1/try/decision']));
  });
});

describe('POST /v1/try/decision', () => {
  it("never decides another buyer's order: another visitor's token, a made-up token or an unknown visitor", async () => {
    gemini = draftFor(200);
    const a = await json(await tryIt({ text: '200 litres of lactose-free milk by Monday' }, { ip: '198.51.100.21' }));
    const b = await json(await tryIt({ text: '200 litres of lactose-free milk by Monday' }, { ip: '198.51.100.22' }));
    const stolen = await decide({ visitor: b.visitor, token: a.approval.token, decision: 'approve' });
    expect(stolen.status).toBe(404);
    expect(await json(stolen)).toMatchObject({ error: 'TOKEN_UNKNOWN' });
    expect((await decide({ visitor: b.visitor, token: 'made-up', decision: 'approve' })).status).toBe(404);
    expect((await db(e).prepare('SELECT state FROM orders WHERE id = ?').bind(a.order.orderId).first<{ state: string }>())!.state).toBe('HELD');
    expect((await decide({ visitor: 'not-a-visitor', token: a.approval.token, decision: 'approve' })).status).toBe(404);
  });

  it('refuses an agent key with 403, like every approval', async () => {
    const keys = await reset();
    gemini = draftFor(200);
    const a = await json(await tryIt({ text: '200 litres of lactose-free milk by Monday' }));
    const r = await decide({ visitor: a.visitor, token: a.approval.token, decision: 'approve' }, { key: keys.agentKeys['hotel-a'] });
    expect(r.status).toBe(403);
    expect(await json(r)).toMatchObject({ error: 'AGENT_CANNOT_APPROVE' });
  });

  it('goes through the normal approval re-check: past the cut-off it expires', async () => {
    gemini = draftFor(200);
    const a = await json(await tryIt({ text: '200 litres of lactose-free milk by Monday' }));
    await setClock(e, '2026-11-15T17:05:00+02:00');
    const d = await json(await decide({ visitor: a.visitor, token: a.approval.token, decision: 'approve' }));
    expect(d.order).toMatchObject({ state: 'EXPIRED', reasons: expect.arrayContaining([expect.objectContaining({ code: 'APPROVAL_EXPIRED' })]) });
  });
});
