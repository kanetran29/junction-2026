import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { insertStatements } from '../scripts/build-index';
import type { Env } from '../src/env';
import { createApp } from '../src/http/routes';
import { clearListsCache } from '../src/interpret/gemini';
import { buildPeppolOrder, escapeXml } from '../src/peppol/order';
import { clearValioBlock } from '../src/valio/client';
import { fakeValio, product } from './quote-helpers';

const e = { ...(env as unknown as Env), DEMO_MODE: '1', VALIO_API_KEY: 'vk', ADMIN_KEY: 'adm', GEMINI_API_KEY: 'gk', GEMINI_MODEL: 'gemini-test', GEMMA_MODEL: 'gemma-test' };
const app = createApp(fakeValio({ P1: { price: 3, stock: 5000 } }).fn);
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
const setFlag = (enabled: boolean) => call('/admin/feature', { key: 'adm', body: { name: 'peppol', enabled } });
const RECORDED_TEXT = '1,000 litres of lactose-free milk by Monday';
const GTIN = '6410405060457';

let keys: { agentKeys: Record<string, string>; approverKeys: Record<string, string> };
let A: string;
let B: string;
let buyerA: string;

/** Quotes and places one offer of `litres` litres for a key; 200 litres of the 3 EUR product is over the 500 EUR automatic limit, so it is HELD. */
async function place(key: string, litres: number): Promise<any> {
  const q = await json(await call('/v1/quotes', { key, body: { draft: need(litres) } }));
  return json(await call('/v1/orders', { key, body: { quoteId: q.id, offerId: q.offers[0].offerId }, headers: { 'Idempotency-Key': crypto.randomUUID() } }));
}

/** The approval token of a held order, read from the approver's inbox. */
async function tokenOf(buyer: string, orderId: string): Promise<string> {
  const inbox = await json(await app.request(`/approver/${keys.approverKeys[buyer]}`, { headers: { Accept: 'application/json' } }, e));
  return inbox.pending.find((p: any) => p.orderId === orderId).token;
}

/** Runs one Try it step as a new visitor from the recorded example sentence, then approves the held order; returns the visitor token, buyer and order id. */
async function sandboxOrder(): Promise<{ visitor: string; buyerId: string; orderId: string }> {
  const r = await json(await app.request('/v1/try', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: RECORDED_TEXT }) }, e));
  const d = await app.request('/v1/try/decision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitor: r.visitor, token: r.approval.token, decision: 'approve' }) }, e);
  expect((await json(d)).order.state).toBe('ACCEPTED');
  return { visitor: r.visitor, buyerId: r.buyerId, orderId: r.order.orderId };
}

afterEach(() => clearValioBlock());

beforeAll(async () => {
  clearListsCache();
  await e.DB.batch(insertStatements([product('P1', { names: [{ language: 'en', value: 'Lactose-free "milk" <1 l>' }], salesUnitGtin: GTIN })]).map((s) => e.DB.prepare(s)));
  await e.DB.prepare("INSERT OR REPLACE INTO category_names(category, names, tag_source) VALUES ('10400','Milk','reviewed')").run();
  keys = await json(await call('/admin/reset', { key: 'adm', body: { clock: '2026-11-13T21:10:00+02:00', replay: null, replayVariant: {}, mandate: { perOrder: { auto: 500, hard: 1000 }, perDay: { auto: 5000, hard: 10000 } } } }));
  [buyerA] = Object.keys(keys.agentKeys);
  A = keys.agentKeys[buyerA];
  B = keys.agentKeys[Object.keys(keys.agentKeys)[1]];
  await setFlag(false);
});

describe('GET /v1/orders/{id}/peppol', () => {
  it('is 404 NOT_FOUND while the feature is off (the default)', async () => {
    const accepted = await place(A, 10);
    const r = await call(`/v1/orders/${accepted.orderId}/peppol`, { key: A });
    expect(r.status).toBe(404);
    expect(await json(r)).toMatchObject({ error: 'NOT_FOUND' });
  });

  it('exports an accepted order as Peppol BIS Order 3.0 XML with the receipt totals, lines and GTIN', async () => {
    await setFlag(true);
    const o = await place(A, 10);
    expect(o).toMatchObject({ state: 'ACCEPTED', order: { netCents: 3000 } });
    const r = await call(`/v1/orders/${o.orderId}/peppol`, { key: A });
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toContain('application/xml');
    expect(r.headers.get('Content-Disposition')).toBe(`attachment; filename="lazydoor-order-${o.orderId}.xml"`);
    const xml = await r.text();
    for (const s of [
      '<cbc:CustomizationID>urn:fdc:peppol.eu:poacc:trns:order:3</cbc:CustomizationID>',
      '<cbc:ProfileID>urn:fdc:peppol.eu:poacc:bis:ordering:3</cbc:ProfileID>',
      `<cbc:ID>${o.orderId}</cbc:ID>`,
      '<cbc:IssueDate>2026-11-13</cbc:IssueDate>',
      '<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>',
      'Demo export from Lazydoor',
      'DEMO-PLACEHOLDER-VALIO-AIMO',
      '<cbc:StartDate>2026-11-16</cbc:StartDate>',
      `<cbc:TaxAmount currencyID="EUR">${((o.order.grossCents - 3000) / 100).toFixed(2)}</cbc:TaxAmount>`,
      '<cbc:LineExtensionAmount currencyID="EUR">30.00</cbc:LineExtensionAmount>',
      `<cbc:TaxInclusiveAmount currencyID="EUR">${(o.order.grossCents / 100).toFixed(2)}</cbc:TaxInclusiveAmount>`,
      '<cbc:Quantity unitCode="H87">10</cbc:Quantity>',
      '<cbc:PriceAmount currencyID="EUR">3.00</cbc:PriceAmount>',
      '<cbc:Name>Lactose-free &quot;milk&quot; &lt;1 l&gt;</cbc:Name>',
      '<cac:SellersItemIdentification><cbc:ID>P1</cbc:ID>',
      `<cbc:ID schemeID="0160">${GTIN}</cbc:ID>`,
    ]) expect(xml).toContain(s);
  });

  it('is 409 ORDER_NOT_ACCEPTED for a HELD order and for a REJECTED one', async () => {
    const held = await place(A, 200);
    expect(held.state).toBe('HELD');
    const r = await call(`/v1/orders/${held.orderId}/peppol`, { key: A });
    expect(r.status).toBe(409);
    expect(await json(r)).toMatchObject({ error: 'ORDER_NOT_ACCEPTED' });
    await call(`/reject/${await tokenOf(buyerA, held.orderId)}`, { method: 'POST' });
    expect((await call(`/v1/orders/${held.orderId}/peppol`, { key: A })).status).toBe(409);
  });

  it("is 404 for another buyer's order, 401 with no key and no visitor header", async () => {
    const o = await place(A, 10);
    expect((await call(`/v1/orders/${o.orderId}/peppol`, { key: B })).status).toBe(404);
    expect((await call(`/v1/orders/${o.orderId}/peppol`)).status).toBe(401);
    expect((await call(`/v1/orders/${o.orderId}/peppol`, { key: 'wrong', headers: { 'X-Visitor-Token': 'v' } })).status).toBe(401);
  });

  it('lets a Try it visitor with X-Visitor-Token export their own sandbox order only', async () => {
    const mine = await sandboxOrder();
    const other = await sandboxOrder();
    const r = await call(`/v1/orders/${mine.orderId}/peppol`, { headers: { 'X-Visitor-Token': mine.visitor } });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain(`<cbc:ID>${mine.orderId}</cbc:ID>`);
    expect((await call(`/v1/orders/${other.orderId}/peppol`, { headers: { 'X-Visitor-Token': mine.visitor } })).status).toBe(404);
    expect((await call(`/v1/orders/${mine.orderId}/peppol`, { headers: { 'X-Visitor-Token': 'unknown' } })).status).toBe(404);
    expect((await call(`/v1/orders/${mine.orderId}`, { headers: { 'X-Visitor-Token': mine.visitor } })).status).toBe(401);
  });
});

describe('GET /approve/{token}/peppol', () => {
  it('gives the approver the XML of the order they approved, and 409 before they have', async () => {
    const held = await place(A, 200);
    const token = await tokenOf(buyerA, held.orderId);
    const before = await call(`/approve/${token}/peppol`);
    expect(before.status).toBe(409);
    expect((await json(await call(`/approve/${token}`, { method: 'POST' }))).state).toBe('ACCEPTED');
    const r = await call(`/approve/${token}/peppol`);
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Disposition')).toContain(`lazydoor-order-${held.orderId}.xml`);
    expect(await r.text()).toContain('<cbc:LineExtensionAmount currencyID="EUR">600.00</cbc:LineExtensionAmount>');
    expect((await call('/approve/nope/peppol')).status).toBe(404);
  });

  it('is 404 when the feature is off', async () => {
    const held = await place(A, 200);
    const token = await tokenOf(buyerA, held.orderId);
    await call(`/approve/${token}`, { method: 'POST' });
    await setFlag(false);
    expect((await call(`/approve/${token}/peppol`)).status).toBe(404);
  });
});

describe('buildPeppolOrder', () => {
  it('escapes markup and drops control characters', () => {
    expect(escapeXml('a & <b> "c" \'d\'\u0001')).toBe('a &amp; &lt;b&gt; &quot;c&quot; &apos;d&apos;');
    const xml = buildPeppolOrder({ id: 'o<1>', state: 'ACCEPTED', lines: [], unmet: [], netCents: 0, grossCents: 0, deliveryDate: null }, { buyerId: 'x&y', decidedAt: '2026-11-13T21:10:00+02:00', products: [] });
    expect(xml).toContain('<cbc:ID>o&lt;1&gt;</cbc:ID>');
    expect(xml).toContain('DEMO-PLACEHOLDER-x&amp;y');
  });
});
