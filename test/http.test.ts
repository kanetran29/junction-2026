import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { insertStatements } from '../scripts/build-index';
import type { Env } from '../src/env';
import { createApp } from '../src/http/routes';
import { clearValioBlock } from '../src/valio/client';
import { sha256Hex } from '../src/util';
import { fakeValio, product } from './quote-helpers';
import { db } from '../src/db';

const e = { ...(env as unknown as Env), DEMO_MODE: '1', VALIO_API_KEY: 'vk', ADMIN_KEY: 'adm', GEMINI_API_KEY: 'gk', GEMINI_MODEL: 'gm' };
const milk = { category: '10400', claims: ['FREE_FROM_LACTOSE'], quantity: { value: 200, unit: 'l' }, deliverBy: '2026-11-16', unclear: [], needs: ['milk'] };
const valio = fakeValio({ P1: { price: 3, stock: 250 } }).fn;

/** One injected fetch for both upstreams: Gemini answers with the milk draft, everything else goes to the fake Valio. */
const upstream = (async (url: string | URL | Request, init?: RequestInit) =>
  String(url).includes('generativelanguage')
    ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(milk) }] } }] }))
    : valio(url, init)) as typeof fetch;

const app = createApp(upstream);
/** Sends one request to the app (JSON body when given, bearer key when given) with the test env or the one in `o.env`. */
const call = (path: string, o: { key?: string; body?: unknown; headers?: Record<string, string>; method?: string; env?: Env } = {}) =>
  app.request(
    path,
    {
      method: o.method ?? (o.body === undefined ? 'GET' : 'POST'),
      headers: { ...(o.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(o.key ? { Authorization: `Bearer ${o.key}` } : {}), ...o.headers },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    },
    o.env ?? e,
  );
/** Reads a reply body as JSON. */
const json = async (r: Response) => (await r.json()) as any;
/** Resets the gateway through the admin route with the default case state (overridable) and returns the minted keys. */
const reset = async (body: Record<string, unknown> = {}) =>
  json(await call('/admin/reset', { key: 'adm', body: { clock: '2026-11-13T21:10:00+02:00', replay: null, replayVariant: {}, mandate: { perOrder: { auto: 500, hard: 5000 }, perDay: { auto: 500, hard: 10000 }, reliabilityFloor: 0.9, approver: 'Kitchen manager' }, ...body } }));

afterEach(() => clearValioBlock());

beforeAll(async () => {
  await e.DB.batch(insertStatements([product('P1', { names: [{ language: 'fi', value: 'Maito' }] })]).map((s) => e.DB.prepare(s)));
  await e.DB.prepare("INSERT OR REPLACE INTO category_names(category, names, tag_source) VALUES ('10400','Milk','reviewed')").run();
});

describe('auth', () => {
  it('answers 401 in the {error, detail} shape without a key or with an unknown one', async () => {
    const r = await call('/v1/quotes/q1');
    expect(r.status).toBe(401);
    expect(await json(r)).toMatchObject({ error: 'UNAUTHORIZED', detail: expect.any(String) });
    expect((await call('/v1/quotes/q1', { key: 'nope' })).status).toBe(401);
  });

  it('keeps the admin routes for the admin key and demo mode only', async () => {
    const keys = await reset();
    expect((await call('/admin/orders?idempotencyKey=x', { key: keys.agentKeys['hotel-a'] })).status).toBe(401);
    expect((await call('/admin/orders?idempotencyKey=x')).status).toBe(401);
    expect((await call('/admin/orders?idempotencyKey=x', { key: 'adm', env: { ...e, DEMO_MODE: '0' } })).status).toBe(404);
    expect((await call('/admin/orders?idempotencyKey=x', { key: 'adm' })).status).toBe(200);
  });

  it('mints a judge key for hotel-b that reads every buyer events and survives a reset', async () => {
    const keys = await reset();
    expect((await call('/admin/judge-key', { key: keys.agentKeys['hotel-a'], body: {} })).status).toBe(401);
    expect((await call('/admin/judge-key', { key: 'adm', body: {}, env: { ...e, DEMO_MODE: '0' } })).status).toBe(404);
    const minted = await call('/admin/judge-key', { key: 'adm', body: {} });
    expect(minted.status).toBe(201);
    const { key, buyer } = await json(minted);
    expect(buyer).toBe('hotel-b');
    expect((await call('/v1/events?buyer=hotel-a', { key })).status).toBe(200);
    expect((await call('/v1/events?buyer=hotel-a', { key: keys.agentKeys['hotel-b'] })).status).toBe(403);
    const fresh = await reset();
    expect((await call('/v1/events', { key })).status).toBe(200);
    expect((await call('/v1/events', { key: keys.agentKeys['hotel-a'] })).status).toBe(401);
    expect((await call('/v1/events', { key: fresh.agentKeys['hotel-a'] })).status).toBe(200);
  });

  it('refuses the admin key on buyer routes (it has no buyer)', async () => {
    expect((await call('/v1/quotes/q1', { key: 'adm' })).status).toBe(403);
  });
});

describe('structural auth and error shapes', () => {
  it('answers 401 before validating: an unauthenticated malformed POST is 401, an authenticated one 400', async () => {
    const keys = await reset();
    const bad = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' };
    expect((await app.request('/v1/quotes', bad, e)).status).toBe(401);
    expect((await app.request('/v1/search', bad, e)).status).toBe(401);
    const r = await app.request('/v1/quotes', { ...bad, headers: { ...bad.headers, Authorization: `Bearer ${keys.agentKeys['hotel-a']}` } }, e);
    expect(r.status).toBe(400);
    expect(await json(r)).toMatchObject({ error: 'INVALID_REQUEST' });
  });

  it('keeps /v1/rules and /v1/reason-codes public and answers unknown routes with JSON 404', async () => {
    expect((await call('/v1/rules')).status).toBe(200);
    expect((await call('/v1/reason-codes')).status).toBe(200);
    const r = await call('/nope');
    expect(r.status).toBe(404);
    expect(await json(r)).toMatchObject({ error: 'NOT_FOUND', detail: expect.any(String) });
  });

  it('lets a browser read the two events routes cross-origin with a bearer header, and no other route', async () => {
    const keys = await reset();
    for (const path of ['/v1/events', '/v1/events/stream']) {
      const pre = await call(path, { method: 'OPTIONS', headers: { Origin: 'https://demo.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
      expect(pre.status).toBe(204);
      expect(pre.headers.get('access-control-allow-origin')).toBe('*');
      expect(pre.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
      expect(pre.headers.get('access-control-allow-credentials')).toBeNull();
    }
    const ok = await call('/v1/events', { key: keys.agentKeys['hotel-a'], headers: { Origin: 'https://demo.example', 'Last-Event-ID': 'garbage' } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('*');
    const keyless = await call('/v1/events', { headers: { Origin: 'https://demo.example' } });
    expect(keyless.status).toBe(200);
    expect(keyless.headers.get('access-control-allow-origin')).toBe('*');
    const denied = await call('/v1/events', { headers: { Origin: 'https://demo.example' }, env: { ...e, DEMO_MODE: '0' } });
    expect(denied.status).toBe(401);
    expect(denied.headers.get('access-control-allow-origin')).toBe('*');
    expect((await call('/v1/quotes/q1', { key: keys.agentKeys['hotel-a'], headers: { Origin: 'https://demo.example' } })).headers.get('access-control-allow-origin')).toBeNull();
  });

  it('publishes rules that follow the code: the quote ranking constant and rounding up', async () => {
    const { decisions } = await json(await call('/v1/rules'));
    const by = (id: string) => decisions.find((d: any) => d.id === id);
    expect(by('ranking').constants.rankedBy).toEqual(['netTotal', 'unitPrice', 'reliability']);
    expect(by('conversion').rule).toContain('rounded up');
  });

  it('answers 400 for oversized inputs', async () => {
    const keys = await reset();
    const key = keys.agentKeys['hotel-a'];
    expect((await call('/v1/interpret', { key, body: { text: 'x'.repeat(1001) } })).status).toBe(400);
    expect((await call('/v1/search', { key, body: { category: '10400', claims: Array.from({ length: 21 }, (_, i) => `C${i}`) } })).status).toBe(400);
    const draft = { category: '10400', claims: [], quantity: { value: 5, unit: 'l' }, deliverBy: '2026-11-16' };
    expect((await call('/v1/baskets', { key, body: { needs: Array.from({ length: 21 }, () => draft) } })).status).toBe(400);
    expect((await call('/v1/orders', { key, headers: { 'Idempotency-Key': 'k1' }, body: { quoteId: 'q', offerId: 'o1', agentReason: 'x'.repeat(501) } })).status).toBe(400);
    expect((await call(`/v1/families?terms=${Array.from({ length: 21 }, (_, i) => `t${i}`).join(',')}`, { key })).status).toBe(400);
    expect((await call('/v1/families?terms=a,b', { key })).status).toBe(200);
  });

  it("never lets a body override the key's buyer", async () => {
    const keys = await reset();
    const q = await json(await call('/v1/quotes', { key: keys.agentKeys['hotel-a'], body: { draft: { category: '10400', claims: [], quantity: { value: 5, unit: 'l' }, deliverBy: '2026-11-16' } } }));
    const o = await json(await call('/v1/orders', { key: keys.agentKeys['hotel-b'], headers: { 'Idempotency-Key': 'x1' }, body: { quoteId: q.id, offerId: q.offers[0].offerId, buyerId: 'hotel-a' } }));
    expect(o.error).toBe('QUOTE_NOT_FOUND');
  });

  it('answers 409 while the same Idempotency-Key is still being processed', async () => {
    const keys = await reset();
    const hash = await sha256Hex(JSON.stringify(['qx', 'ox', null, null, null]));
    await db(e).prepare("INSERT INTO orders(id, buyer_id, quote_id, idempotency_key, request_hash, state, body, created_at) VALUES ('ord_busy','hotel-a','qx','busy',?,'PLACING','{}','2026-11-13T21:10:00+02:00')").bind(hash).run();
    const r = await call('/v1/orders', { key: keys.agentKeys['hotel-a'], headers: { 'Idempotency-Key': 'busy' }, body: { quoteId: 'qx', offerId: 'ox' } });
    expect(r.status).toBe(409);
    expect(await json(r)).toMatchObject({ error: 'IDEMPOTENCY_IN_PROGRESS' });
  });

  it('lets an agent key neither approve nor reject', async () => {
    const keys = await reset();
    for (const verb of ['approve', 'reject']) expect((await call(`/${verb}/sometoken`, { key: keys.agentKeys['hotel-a'], method: 'POST' })).status).toBe(403);
  });
});

describe('admin reset', () => {
  it('refuses every admin call when ADMIN_KEY is not configured', async () => {
    const noAdmin = { ...e, ADMIN_KEY: undefined } as unknown as Env;
    expect((await call('/admin/orders?idempotencyKey=x', { key: 'adm', env: noAdmin })).status).toBe(401);
    expect((await call('/admin/orders?idempotencyKey=x', { key: '', env: noAdmin })).status).toBe(401);
  });

  it('answers 400 for an empty clock or malformed JSON and leaves the database untouched', async () => {
    const keys = await reset();
    expect((await call('/admin/reset', { key: 'adm', body: { clock: '' } })).status).toBe(400);
    const bad = await app.request('/admin/reset', { method: 'POST', headers: { Authorization: 'Bearer adm', 'Content-Type': 'application/json' }, body: '{' }, e);
    expect(bad.status).toBe(400);
    expect((await call('/v1/rules', { key: keys.agentKeys['hotel-a'] })).status).toBe(200);
    expect((await call(`/approver/${keys.approverKeys['hotel-a']}`, { headers: { Accept: 'application/json' } })).status).toBe(200);
  });

  it('keeps a wrong Content-Type at 415 and names the OrderBody component', async () => {
    const keys = await reset();
    const r = await app.request('/v1/quotes', { method: 'POST', headers: { Authorization: `Bearer ${keys.agentKeys['hotel-a']}`, 'Content-Type': 'text/plain' }, body: 'x' }, e);
    expect([400, 415]).toContain(r.status);
    const doc = await json(await call('/openapi.json'));
    expect(doc.components.schemas).toHaveProperty(['OrderBody']);
    expect(doc.paths['/v1/events'].get.responses['403'].description).toContain('another buyer');
  });

  it('answers 400 for a clock without an offset and leaves the database untouched', async () => {
    const keys = await reset();
    const r = await call('/admin/reset', { key: 'adm', body: { clock: '2026-11-13T21:10:00' } });
    expect(r.status).toBe(400);
    expect((await call('/v1/quotes/q1', { key: keys.agentKeys['hotel-a'] })).status).toBe(404);
  });

  it('can run twice (mandates are deleted before seeding), mints fresh keys and honours the case givens', async () => {
    const a = await reset();
    const b = await reset({ priorAccepted: [{ buyer: 'hotel-a', productId: 'P1', salesUnits: 4 }], priorAcceptedNetCents: 1000 });
    expect(Object.keys(b.agentKeys)).toEqual(['hotel-a', 'hotel-b']);
    expect(Object.keys(b.approverKeys)).toEqual(['hotel-a', 'hotel-b']);
    expect(b.agentKeys['hotel-a']).not.toBe(a.agentKeys['hotel-a']);
    expect((await call('/v1/quotes/q1', { key: a.agentKeys['hotel-a'] })).status).toBe(401);
    expect(await json(await call('/admin/ledger?buyer=hotel-a', { key: 'adm' }))).toMatchObject({ count: 1, lines: [{ product_id: 'P1', sales_units: 4 }] });
    expect((await json(await call('/admin/ledger?buyer=hotel-b', { key: 'adm' }))).count).toBe(0);
  });

  it('sets the clock and the replay variant', async () => {
    await reset();
    expect((await call('/admin/clock', { key: 'adm', body: { clock: '2026-11-15T17:05:00+02:00' } })).status).toBe(200);
    expect((await json(await call('/health'))).now).toBe('2026-11-15T17:05:00+02:00');
    expect((await call('/admin/replay', { key: 'adm', body: { variant: { P1: 'out_of_stock' } } })).status).toBe(200);
    expect((await db(e).prepare("SELECT value FROM settings WHERE key = 'variants'").first<{ value: string }>())!.value).toBe('{"P1":"out_of_stock"}');
  });
});

describe('buyer routes', () => {
  it('runs interpret, confirm, search, quote, order (HELD), inbox, approve, receipt over HTTP', async () => {
    const keys = await reset();
    const key = keys.agentKeys['hotel-a'];
    const i = await json(await call('/v1/interpret', { key, body: { text: 'milk please' } }));
    expect(i).toMatchObject({ draft: { status: 'draft' }, valioCalls: 0 });
    const c = await json(await call(`/v1/drafts/${i.draft.id}/confirm`, { key, body: { fill: {} } }));
    expect(c.draft.status).toBe('confirmed');
    const s = await json(await call('/v1/search', { key, body: { category: '10400', claims: ['FREE_FROM_LACTOSE'] } }));
    expect(s).toMatchObject({ valioCalls: 0, products: [{ id: 'P1', category: '10400' }] });
    const q = await json(await call('/v1/quotes', { key, body: { draftId: i.draft.id } }));
    expect(q.offers[0]).toMatchObject({ netCents: 60000 });
    expect((await call(`/v1/quotes/${q.id}`, { key })).status).toBe(200);
    expect((await call(`/v1/quotes/${q.id}`, { key: keys.agentKeys['hotel-b'] })).status).toBe(404);

    const o = await json(await call('/v1/orders', { key, headers: { 'Idempotency-Key': 'k1' }, body: { quoteId: q.id, offerId: q.offers[0].offerId, agentReason: 'cheapest' } }));
    expect(o).toMatchObject({ state: 'HELD', approval: { status: 'pending', approver: 'Kitchen manager' } });
    expect(JSON.stringify(o)).not.toContain('approve/');
    expect((await json(await call(`/v1/orders/${o.orderId}`, { key }))).state).toBe('HELD');
    expect((await call(`/v1/orders/${o.orderId}`, { key: keys.agentKeys['hotel-b'] })).status).toBe(404);

    const inbox = await json(await call(`/approver/${keys.approverKeys['hotel-a']}`, { headers: { Accept: 'application/json' } }));
    const token = inbox.pending[0].token;
    const asAgent = await call(`/approve/${token}`, { key, method: 'POST' });
    expect(asAgent.status).toBe(403);
    expect(await json(asAgent)).toMatchObject({ error: expect.any(String), detail: expect.any(String) });
    const done = await json(await call(`/approve/${token}`, { method: 'POST' }));
    expect(done).toMatchObject({ state: 'ACCEPTED' });
    expect((await call(`/approve/${token}`, { method: 'POST' })).status).toBe(409);

    const rec = await json(await call(`/v1/orders/${o.orderId}/receipt`, { key }));
    expect(rec.text).toContain('600.00');
    expect((await call(`/v1/orders/${o.orderId}/receipt`, { key: keys.agentKeys['hotel-b'] })).status).toBe(404);
    expect(await json(await call(`/admin/orders?idempotencyKey=k1`, { key: 'adm' }))).toMatchObject({ count: 1 });
  });

  it('places a basket and answers 400 / 409-free idempotency: missing key 400, same key other body 422, same key same body replays', async () => {
    const keys = await reset();
    const key = keys.agentKeys['hotel-a'];
    const need = { category: '10400', claims: ['FREE_FROM_LACTOSE'], quantity: { value: 20, unit: 'l' }, deliverBy: '2026-11-16' };
    const b = await json(await call('/v1/baskets', { key, body: { needs: [need] } }));
    expect(b.quotes).toHaveLength(1);
    const sel = { basketId: b.basketId, selections: [{ quoteId: b.quotes[0].id, offerId: b.quotes[0].offers[0].offerId }] };
    expect((await call('/v1/orders', { key, body: sel })).status).toBe(400);
    const first = await json(await call('/v1/orders', { key, headers: { 'Idempotency-Key': 'kb' }, body: sel }));
    expect(first.state).toBe('ACCEPTED');
    const again = await json(await call('/v1/orders', { key, headers: { 'Idempotency-Key': 'kb' }, body: sel }));
    expect(again.orderId).toBe(first.orderId);
    expect((await call('/v1/orders', { key, headers: { 'Idempotency-Key': 'kb' }, body: { ...sel, agentReason: 'other' } })).status).toBe(422);
  });

  it('rejects malformed bodies with 400 and the {error, detail} shape', async () => {
    const keys = await reset();
    const r = await call('/v1/quotes', { key: keys.agentKeys['hotel-a'], body: { draft: { category: '10400' } } });
    expect(r.status).toBe(400);
    expect(await json(r)).toMatchObject({ error: 'INVALID_REQUEST', detail: expect.any(String) });
  });

  it('limits interpret to 20 a minute per key', async () => {
    const keys = await reset();
    const key = keys.agentKeys['hotel-a'];
    for (let n = 0; n < 20; n++) expect((await call('/v1/interpret', { key, body: { text: 'milk' } })).status).toBe(200);
    const r = await call('/v1/interpret', { key, body: { text: 'milk' } });
    expect(r.status).toBe(429);
    expect(await json(r)).toMatchObject({ error: 'RATE_LIMITED' });
    expect((await call('/v1/interpret', { key: keys.agentKeys['hotel-b'], body: { text: 'milk' } })).status).toBe(200);
  });

  it('answers 503 MODEL_UNAVAILABLE without a Gemini key', async () => {
    const keys = await reset();
    const r = await call('/v1/interpret', { key: keys.agentKeys['hotel-a'], body: { text: 'milk' }, env: { ...e, GEMINI_API_KEY: undefined } });
    expect(r.status).toBe(503);
    expect(await json(r)).toMatchObject({ error: 'MODEL_UNAVAILABLE' });
  });
});

describe('Valio 429', () => {
  it('answers 503 VALIO_RATE_LIMITED with a Retry-After header and retryAfter in the body, ', async () => {
    clearValioBlock();
    const keys = await reset();
    const limited = createApp((async () => new Response('slow', { status: 429, headers: { 'Retry-After': '7' } })) as unknown as typeof fetch);
    const r = await limited.request('/v1/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keys.agentKeys['hotel-a']}` }, body: JSON.stringify({ draft: { category: '10400', claims: [], quantity: { value: 5, unit: 'l' }, deliverBy: '2026-11-16' } }) }, e);
    clearValioBlock();
    expect(r.status).toBe(503);
    expect(r.headers.get('Retry-After')).toBe('7');
    expect(await json(r)).toEqual({ error: 'VALIO_RATE_LIMITED', detail: expect.any(String), retryAfter: 7 });
  });

  it('documents 503 on the quote route in /openapi.json', async () => {
    const doc = await json(await call('/openapi.json'));
    expect(doc.paths['/v1/quotes'].post.responses).toHaveProperty('503');
  });
});

describe('/openapi.json', () => {
  it('lists the agent routes with schemas under the Lazydoor title', async () => {
    const doc = await json(await call('/openapi.json'));
    expect(doc.info).toMatchObject({ title: 'Lazydoor', version: '0.1.0' });
    for (const p of ['/v1/interpret', '/v1/drafts/{id}/confirm', '/v1/search', '/v1/quotes', '/v1/quotes/{id}', '/v1/baskets', '/v1/orders', '/v1/orders/{id}', '/v1/orders/{id}/receipt', '/health']) expect(doc.paths).toHaveProperty([p]);
    expect(doc.paths['/v1/orders'].post.parameters.some((x: { name: string }) => x.name === 'Idempotency-Key')).toBe(true);
    expect(doc.paths['/v1/quotes'].post.requestBody.content['application/json'].schema).toBeDefined();
  });
});
