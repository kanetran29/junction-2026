import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertStatements } from '../scripts/build-index';
import type { Env } from '../src/env';
import { createApp } from '../src/http/routes';
import { mcpRoutes } from '../src/mcp/tools';
import { clearListsCache } from '../src/interpret/gemini';
import { fakeValio, product } from './quote-helpers';
import { decodeJws, verifyWithJwks } from './jws-helpers';

const e = { ...(env as unknown as Env), DEMO_MODE: '1', VALIO_API_KEY: 'vk', ADMIN_KEY: 'adm' };
const app = createApp(fakeValio({ P1: { price: 3, stock: 300 } }).fn);
app.route('/', mcpRoutes(fakeValio({ P1: { price: 3, stock: 300 } }).fn));
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

let keys: { agentKeys: Record<string, string>; approverKeys: Record<string, string> };
let A: string;
let B: string;
let buyerA: string;

/** Quotes and places `litres` litres of the 3 € product for a key: 160 l (480 €) is AUTO, 170 l (510 €) is HELD. */
async function place(key: string, litres: number): Promise<any> {
  return order(key, await json(await call('/v1/quotes', { key, body: { draft: need(litres) } })));
}

/** Places the first offer of a quote with a fresh Idempotency-Key. */
const order = async (key: string, q: any) => json(await call('/v1/orders', { key, body: { quoteId: q.id, offerId: q.offers[0].offerId }, headers: { 'Idempotency-Key': crypto.randomUUID() } }));

/** Cancels an order through the HTTP route. */
const cancel = (key: string, id: string, reason?: string) => call(`/v1/orders/${id}/cancel`, { key, body: reason ? { reason } : {}, headers: { 'Idempotency-Key': crypto.randomUUID() } });

beforeAll(async () => {
  clearListsCache();
  await e.DB.batch(insertStatements([product('P1')]).map((s) => e.DB.prepare(s)));
  await e.DB.prepare("INSERT OR REPLACE INTO category_names(category, names, tag_source) VALUES ('10400','Milk','reviewed')").run();
});

beforeEach(async () => {
  keys = await json(await call('/admin/reset', { key: 'adm', body: { clock: '2026-11-13T21:10:00+02:00', replay: null, replayVariant: {}, mandate: { perOrder: { auto: 500, hard: 800 }, perDay: { auto: 600, hard: 10000 } } } }));
  [buyerA] = Object.keys(keys.agentKeys);
  A = keys.agentKeys[buyerA];
  B = keys.agentKeys[Object.keys(keys.agentKeys)[1]];
});

describe('POST /v1/orders/{id}/cancel', () => {
  it('cancels an accepted order before the cut-off with a signed record, and frees its stock for another agent', async () => {
    const quoteB = await json(await call('/v1/quotes', { key: B, body: { draft: need(160) } }));
    const o = await place(A, 160);
    expect(o.state).toBe('ACCEPTED');
    expect((await order(B, quoteB)).reason).toBe('STOCK_TAKEN');

    const r = await cancel(A, o.orderId, 'menu changed');
    expect(r.status).toBe(200);
    const c = await json(r);
    expect(c).toMatchObject({ orderId: o.orderId, state: 'CANCELLED', cancellation: { orderId: o.orderId, state: 'CANCELLED', reason: 'menu changed', refundedNetCents: 48000, currency: 'EUR', by: { role: 'agent', keyId: expect.stringMatching(/^k_[0-9a-f]{12}$/) } } });
    expect(c.cancellation.lines).toEqual([expect.objectContaining({ productId: 'P1', salesUnits: 160 })]);
    expect(c.cancellation.cancelledAt).toMatch(/\+02:00$/);

    const set = await json(await call('/.well-known/jwks.json'));
    expect(await verifyWithJwks(c.jws, set)).toBe(true);
    expect(decodeJws(c.jws).claims).toMatchObject({ ...c.cancellation, aud: 'lazydoor:cancellation' });
    const [h, p, s] = c.jws.split('.');
    const tampered = btoa(JSON.stringify({ ...decodeJws(c.jws).claims, refundedNetCents: 1 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(p).not.toBe(tampered);
    expect(await verifyWithJwks(`${h}.${tampered}.${s}`, set)).toBe(false);

    expect((await json(await call(`/v1/orders/${o.orderId}`, { key: A }))).state).toBe('CANCELLED');
    expect((await order(B, quoteB)).state).toBe('ACCEPTED');
    const events = await json(await call('/v1/events?since=0', { key: A }));
    expect(events.events.map((ev: any) => ev.type)).toContain('order.cancelled');
    expect((await json(await call('/v1/audit/verify'))).valid).toBe(true);
  });

  it('is idempotent: a second cancel returns the same signed record', async () => {
    const o = await place(A, 100);
    const first = await json(await cancel(A, o.orderId));
    const again = await cancel(A, o.orderId);
    expect(again.status).toBe(200);
    expect((await json(again)).jws).toBe(first.jws);
  });

  it('no longer counts a cancelled order in the day total', async () => {
    const o = await place(A, 160);
    await cancel(A, o.orderId);
    expect((await place(A, 160)).state).toBe('ACCEPTED');
  });

  it('withdraws a held order: the approval link says so and cannot approve it', async () => {
    const o = await place(A, 170);
    expect(o.state).toBe('HELD');
    const inbox = await json(await app.request(`/approver/${keys.approverKeys[buyerA]}`, { headers: { Accept: 'application/json' } }, e));
    const pending = inbox.pending.find((p: any) => p.orderId === o.orderId);
    expect((await cancel(A, o.orderId)).status).toBe(200);
    const page = await app.request(pending.url, {}, e);
    expect(await page.text()).toContain('withdrawn');
    const tryApprove = await app.request(pending.url, { method: 'POST', headers: { Accept: 'application/json' } }, e);
    expect(tryApprove.status).toBe(409);
    expect(await json(tryApprove)).toMatchObject({ error: 'ORDER_WITHDRAWN' });
  });

  it("refuses after Valio's cut-off with ORDER_CUTOFF_PASSED, which /v1/reason-codes explains", async () => {
    const o = await place(A, 100);
    await call('/admin/clock', { key: 'adm', body: { clock: '2026-11-15T17:05:00+02:00' } });
    const r = await cancel(A, o.orderId);
    expect(r.status).toBe(409);
    expect(await json(r)).toMatchObject({ error: 'ORDER_CUTOFF_PASSED' });
    expect((await json(await call(`/v1/orders/${o.orderId}`, { key: A }))).state).toBe('ACCEPTED');
    const codes = (await json(await call('/v1/reason-codes'))).codes.map((c: any) => c.code);
    expect(codes).toEqual(expect.arrayContaining(['ORDER_CUTOFF_PASSED', 'ORDER_NOT_CANCELLABLE', 'ORDER_WITHDRAWN']));
  });

  it("is 404 for another buyer's order and 409 ORDER_NOT_CANCELLABLE for a rejected one", async () => {
    const rejected = await place(A, 280);
    const o = await place(A, 100);
    expect((await cancel(B, o.orderId)).status).toBe(404);
    expect(rejected.state).toBe('REJECTED');
    const r = await cancel(A, rejected.orderId);
    expect(r.status).toBe(409);
    expect(await json(r)).toMatchObject({ error: 'ORDER_NOT_CANCELLABLE' });
  });

  it('is the cancel_order MCP tool, with the same record', async () => {
    const o = await place(A, 100);
    const rpc = await app.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${A}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'cancel_order', arguments: { id: o.orderId, reason: 'mcp' } } }) }, e);
    const out = (await rpc.json()) as any;
    expect(out.result.isError).toBe(false);
    expect(out.result.structuredContent).toMatchObject({ orderId: o.orderId, state: 'CANCELLED', cancellation: { reason: 'mcp' } });
  });

  it('puts the cancellation in the plain-words receipt', async () => {
    const o = await place(A, 100);
    await cancel(A, o.orderId, 'menu changed');
    const r = await json(await call(`/v1/orders/${o.orderId}/receipt`, { key: A }));
    expect(r.text).toMatch(/Cancelled .*before Valio's cut-off.*menu changed/);
  });
});
