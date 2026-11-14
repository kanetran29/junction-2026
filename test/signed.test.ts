import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { insertStatements } from '../scripts/build-index';
import type { Env } from '../src/env';
import { createApp } from '../src/http/routes';
import { toolDefinitions } from '../src/mcp/tools';
import { AUD } from '../src/sign/door';
import { b64u, canonicalJson } from '../src/util';
import { clearValioBlock } from '../src/valio/client';
import { decodeJws, verifyWithJwks } from './jws-helpers';
import { fakeValio, product } from './quote-helpers';

const e = { ...(env as unknown as Env), DEMO_MODE: '1', VALIO_API_KEY: 'vk', ADMIN_KEY: 'adm' };
const app = createApp(fakeValio({ P1: { price: 3, stock: 250 }, P2: { price: 4, stock: 250 } }).fn);
const call = (path: string, o: { key?: string; body?: unknown; headers?: Record<string, string>; method?: string } = {}) =>
  app.request(
    path,
    {
      method: o.method ?? (o.body === undefined ? 'GET' : 'POST'),
      headers: { ...(o.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(o.key ? { Authorization: `Bearer ${o.key}` } : {}), ...o.headers },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    },
    e,
  );
const json = async (r: Response) => (await r.json()) as any;
const need = (litres: number) => ({ category: '10400', claims: ['FREE_FROM_LACTOSE'], quantity: { value: litres, unit: 'l' }, deliverBy: '2026-11-16' });
const enc = new TextEncoder();
let keys: { agentKeys: Record<string, string>; approverKeys: Record<string, string> };
let A: string;

/** Places one offer with a fresh Idempotency-Key, optionally carrying a quote JWS. */
const place = (quoteId: string, offerId: string, quoteJws?: string) =>
  call('/v1/orders', { key: A, body: { quoteId, offerId, ...(quoteJws === undefined ? {} : { quoteJws }) }, headers: { 'Idempotency-Key': crypto.randomUUID() } });

/** The claims an offer's JWS must bind, computed here from the quote reply alone. */
const expectedOfferClaims = (q: any, o: any) => ({
  quoteId: q.id,
  offerId: o.offerId,
  buyerId: q.buyerId,
  deliveryDate: o.deliveryDate,
  lines: o.lines.map((l: any) => ({ productId: l.productId, salesUnits: l.salesUnits, unitPriceCents: l.netCentsPerSalesUnit, netCents: Math.round(l.netCentsPerSalesUnit * l.salesUnits) })),
  netCents: o.netCents,
  grossCents: o.grossCents,
  currency: 'EUR',
  validUntil: q.expiresAt,
  iat: Math.floor(Date.parse(q.createdAt) / 1000),
  aud: AUD.quote,
});

/** A copy of a JWS whose claims were edited, keeping the original header and signature. */
const edited = (jws: string, change: (c: Record<string, unknown>) => void) => {
  const [h, , s] = jws.split('.');
  const { claims } = decodeJws(jws);
  change(claims);
  return `${h}.${b64u(enc.encode(canonicalJson(claims)))}.${s}`;
};

afterEach(() => clearValioBlock());

beforeAll(async () => {
  await e.DB.batch(insertStatements([product('P1'), product('P2')]).map((s) => e.DB.prepare(s)));
});

describe('signed quote offers', () => {
  beforeAll(async () => {
    keys = await json(await call('/admin/reset', { key: 'adm', body: { clock: '2026-11-13T21:10:00+02:00', replay: null, replayVariant: {}, mandate: { perOrder: { auto: 500, hard: 1000 }, perDay: { auto: 5000, hard: 10000 } } } }));
    A = keys.agentKeys['hotel-a'];
  });

  it('signs every offer over its bound fields; the JWS verifies with the published JWKS alone', async () => {
    const q = await json(await call('/v1/quotes', { key: A, body: { draft: need(100) } }));
    const set = await json(await call('/.well-known/jwks.json'));
    expect(q.offers.length).toBeGreaterThan(1);
    for (const o of q.offers) {
      expect(await verifyWithJwks(o.jws, set)).toBe(true);
      expect(decodeJws(o.jws).claims).toEqual(expectedOfferClaims(q, o));
    }
    expect((await json(await call(`/v1/quotes/${q.id}`, { key: A }))).offers[0].jws).toBe(q.offers[0].jws);
  });

  it('accepts an order that carries the offer JWS, and one that carries none', async () => {
    const q = await json(await call('/v1/quotes', { key: A, body: { draft: need(10) } }));
    expect((await json(await place(q.id, q.offers[0].offerId, q.offers[0].jws))).state).toBe('ACCEPTED');
    expect((await json(await place(q.id, q.offers[0].offerId))).state).toBe('ACCEPTED');
  });

  it('refuses a JWS whose price was changed, one from another offer and one signed by another key, placing nothing', async () => {
    const q = await json(await call('/v1/quotes', { key: A, body: { draft: need(10) } }));
    const [o1, o2] = q.offers;
    const cheaper = edited(o1.jws, (c) => (c.netCents = 1));
    const other = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const { header, claims } = decodeJws(o1.jws);
    const input = `${b64u(enc.encode(canonicalJson(header)))}.${b64u(enc.encode(canonicalJson(claims)))}`;
    const forged = `${input}.${b64u(new Uint8Array(await crypto.subtle.sign('Ed25519', (other as CryptoKeyPair).privateKey, enc.encode(input))))}`;
    for (const bad of [cheaper, o2.jws, forged, 'not-a-jws']) {
      const key = crypto.randomUUID();
      const r = await call('/v1/orders', { key: A, body: { quoteId: q.id, offerId: o1.offerId, quoteJws: bad }, headers: { 'Idempotency-Key': key } });
      expect(r.status).toBe(422);
      expect(await json(r)).toMatchObject({ error: 'QUOTE_SIGNATURE_INVALID' });
      expect((await json(await call(`/admin/orders?idempotencyKey=${key}`, { key: 'adm' }))).count).toBe(0);
    }
  });

  it('checks each selection of a basket the same way', async () => {
    const b = await json(await call('/v1/baskets', { key: A, body: { needs: [need(5), need(6)] } }));
    const sel = b.quotes.map((q: any) => ({ quoteId: q.id, offerId: q.offers[0].offerId, quoteJws: q.offers[0].jws }));
    const bad = await call('/v1/orders', { key: A, body: { basketId: b.basketId, selections: [sel[0], { ...sel[1], quoteJws: sel[0].quoteJws }] }, headers: { 'Idempotency-Key': crypto.randomUUID() } });
    expect(await json(bad)).toMatchObject({ error: 'QUOTE_SIGNATURE_INVALID' });
    const ok = await call('/v1/orders', { key: A, body: { basketId: b.basketId, selections: sel }, headers: { 'Idempotency-Key': crypto.randomUUID() } });
    expect((await json(ok)).state).toBe('ACCEPTED');
  });

  it('without a signing key refuses quotes and orders before anything is logged or booked', async () => {
    const q = await json(await call('/v1/quotes', { key: A, body: { draft: need(10) } }));
    const noKey = { ...e, DOOR_SIGNING_JWK: '' };
    const before = (await json(await call('/v1/events', { key: 'adm' }))).events.length;
    const ledger = (await json(await call('/admin/ledger?buyer=hotel-a', { key: 'adm' }))).count;
    const key = crypto.randomUUID();
    const placed = await app.request('/v1/orders', { method: 'POST', headers: { Authorization: `Bearer ${A}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ quoteId: q.id, offerId: q.offers[0].offerId }) }, noKey);
    expect(placed.status).toBe(500);
    const quoted = await app.request('/v1/quotes', { method: 'POST', headers: { Authorization: `Bearer ${A}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: need(10) }) }, noKey);
    expect(quoted.status).toBe(500);
    expect((await json(await call('/v1/events', { key: 'adm' }))).events.length).toBe(before);
    expect((await json(await call('/admin/ledger?buyer=hotel-a', { key: 'adm' }))).count).toBe(ledger);
    expect((await json(await call(`/admin/orders?idempotencyKey=${key}`, { key: 'adm' }))).count).toBe(0);
  });

  it('publishes the new reason code and rule, and lets MCP agents send the JWS back', async () => {
    const codes = (await json(await call('/v1/reason-codes'))).codes;
    expect(codes.find((c: any) => c.code === 'QUOTE_SIGNATURE_INVALID')).toMatchObject({ resolution: 'requires_buyer_input', retryable: false });
    const rules = (await json(await call('/v1/rules'))).decisions;
    expect(rules.find((d: any) => d.id === 'signatures')?.rule).toContain('QUOTE_SIGNATURE_INVALID');
    const placeTool = toolDefinitions.find((t) => t.name === 'place_order')!;
    expect(JSON.stringify(placeTool.inputSchema)).toContain('quoteJws');
    expect(JSON.stringify(toolDefinitions.find((t) => t.name === 'get_quote')!.outputSchema)).toContain('jws');
  });
});

describe('signed receipts', () => {
  beforeAll(async () => {
    keys = await json(await call('/admin/reset', { key: 'adm', body: { clock: '2026-11-13T21:10:00+02:00', replay: null, replayVariant: {}, mandate: { perOrder: { auto: 500, hard: 1000 }, perDay: { auto: 5000, hard: 10000 } } } }));
    A = keys.agentKeys['hotel-a'];
  });

  /** The claims a final order's JWS must bind, from the order reply alone. */
  const receiptClaims = (r: any, approvedBy: string | null, decidedAt: string) => ({
    orderId: r.orderId,
    buyerId: 'hotel-a',
    state: r.state,
    lines: r.order.lines.map((l: any) => ({ productId: l.productId, salesUnits: l.salesUnits, unitPriceCents: l.netCentsPerSalesUnit, netCents: Math.round(l.netCentsPerSalesUnit * l.salesUnits), deliveryDate: l.deliveryDate })),
    netCents: r.order.netCents,
    grossCents: r.order.grossCents,
    currency: 'EUR',
    approvedBy,
    decidedAt,
    aud: AUD.receipt,
  });

  it('signs an order the mandate accepted, in the reply, on read and with the receipt', async () => {
    const set = await json(await call('/.well-known/jwks.json'));
    const q = await json(await call('/v1/quotes', { key: A, body: { draft: need(10) } }));
    const r = await json(await place(q.id, q.offers[0].offerId));
    expect(r.state).toBe('ACCEPTED');
    expect(await verifyWithJwks(r.jws, set)).toBe(true);
    expect(decodeJws(r.jws).claims).toEqual(receiptClaims(r, null, '2026-11-13T21:10:00+02:00'));
    expect((await json(await call(`/v1/orders/${r.orderId}`, { key: A }))).jws).toBe(r.jws);
    const receipt = await json(await call(`/v1/orders/${r.orderId}/receipt`, { key: A }));
    expect(receipt).toEqual({ text: expect.stringContaining('ACCEPTED'), jws: r.jws });
  });

  it('signs a held order only once it is decided, naming the approver and the decision time', async () => {
    const q = await json(await call('/v1/quotes', { key: A, body: { draft: need(200) } }));
    const held = await json(await place(q.id, q.offers[0].offerId));
    expect(held.state).toBe('HELD');
    expect(held.jws).toBeUndefined();
    expect((await json(await call(`/v1/orders/${held.orderId}/receipt`, { key: A }))).jws).toBeUndefined();
    await call('/admin/clock', { key: 'adm', body: { clock: '2026-11-14T10:15:00+02:00' } });
    const inbox = await json(await call(`/approver/${keys.approverKeys['hotel-a']}`, { headers: { Accept: 'application/json' } }));
    const token = inbox.pending.find((p: any) => p.orderId === held.orderId).token;
    expect((await json(await call(`/approve/${token}`, { method: 'POST', headers: { Accept: 'application/json' } }))).state).toBe('ACCEPTED');
    const done = await json(await call(`/v1/orders/${held.orderId}`, { key: A }));
    expect(decodeJws(done.jws).claims).toEqual(receiptClaims(done, 'Kitchen manager', '2026-11-14T10:15:00+02:00'));
    await call('/admin/clock', { key: 'adm', body: { clock: '2026-11-13T21:10:00+02:00' } });
  });

  it('signs a rejected order too', async () => {
    const q = await json(await call('/v1/quotes', { key: A, body: { draft: need(400) } }));
    const r = await json(await place(q.id, q.offers[0].offerId));
    expect(r.state).toBe('REJECTED');
    expect(decodeJws(r.jws).claims).toMatchObject({ orderId: r.orderId, state: 'REJECTED', approvedBy: null, decidedAt: '2026-11-13T21:10:00+02:00' });
  });
});
