import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertStatements } from '../scripts/build-index';
import { setClock } from '../src/clock';
import type { Env } from '../src/env';
import { seedMandate } from '../src/mandate/jws';
import { approverInbox, placeOrder, sha256Hex } from '../src/orders/store';
import { createQuote } from '../src/quote/store';
import { uiRoutes } from '../src/ui/approve';
import { fakeValio, product, type Row } from './quote-helpers';

const e = { ...(env as unknown as Env), DEMO_MODE: '1', VALIO_API_KEY: 'test-key' };
const rows: Record<string, Row> = { QS: { price: 3, stock: 250 }, QU: { price: 3 } };
const valio = fakeValio(rows).fn;
const app = uiRoutes(valio);
const get = (path: string, accept = 'text/html') => app.request(path, { headers: { Accept: accept } }, e);
const post = (path: string, accept = 'text/html') => app.request(path, { method: 'POST', headers: { Accept: accept } }, e);
let n = 0;

/** Places one held order for 200 units of a product (600 EUR, over the auto limit) with the given agent reason; returns its token and id. */
async function hold(id: string, agentReason = 'Cheapest <script>alert(1)</script> option'): Promise<{ token: string; orderId: string }> {
  const q = await createQuote(e, 'hotel-a', { products: [id], quantity: { value: 200, unit: 'l' }, deliverBy: '2026-11-16' }, valio);
  const r = await placeOrder(e, { buyerId: 'hotel-a', idempotencyKey: `k${++n}`, quoteId: q.id, offerId: 'o1', agentReason }, valio);
  const p = (await approverInbox(e, 'ak-a')).pending.find((x) => x.orderId === r.orderId)!;
  return { token: p.token, orderId: r.orderId };
}

beforeAll(async () => {
  const names = (id: string) => [{ language: 'fi', value: `Maito <i>${id}</i>` }];
  await e.DB.batch(insertStatements(['QS', 'QU'].map((id) => product(id, { names: names(id) }))).map((s) => e.DB.prepare(s)));
  await seedMandate(e, 'hotel-a');
  await e.DB.prepare('DELETE FROM approver_keys').run();
  await e.DB.prepare('INSERT INTO approver_keys(key_hash, buyer_id, approver) VALUES (?,?,?)').bind(await sha256Hex('ak-a'), 'hotel-a', 'Kitchen manager').run();
});

beforeEach(async () => {
  for (const t of ['events', 'quotes', 'drafts', 'baskets', 'order_lines', 'orders']) await e.DB.prepare(`DELETE FROM ${t}`).run();
  await setClock(e, '2026-11-13T19:10:00Z');
});

describe('GET /approve/:token', () => {
  it('shows lines, the understood need, the reason, totals, live stock, the cut-off and both forms', async () => {
    const { token } = await hold('QS');
    const res = await get(`/approve/${token}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<title>Lazydoor – approve order</title>');
    for (const s of ['QS', 'Requested 200 l, delivered 200 l', 'OVER_ORDER_AUTO', 'Need, as understood', '&quot;deliverBy&quot;', 'Net 600.00 EUR', 'Gross 681.00 EUR', 'not reserved: 250 available now', 'data-cutoff="2026-11-15T17:00:00+02:00"', `action="/approve/${token}"`, `action="/reject/${token}"`]) expect(html).toContain(s);
  });

  it('is write-free: the order stays HELD and no event is logged', async () => {
    const { token, orderId } = await hold('QS');
    const before = (await e.DB.prepare('SELECT COUNT(*) AS c FROM events').first<{ c: number }>())!.c;
    await get(`/approve/${token}`);
    expect((await e.DB.prepare('SELECT state FROM orders WHERE id = ?').bind(orderId).first<{ state: string }>())!.state).toBe('HELD');
    expect((await e.DB.prepare('SELECT COUNT(*) AS c FROM events').first<{ c: number }>())!.c).toBe(before);
  });

  it('escapes the agent reason and product names', async () => {
    const { token } = await hold('QS');
    const html = await (await get(`/approve/${token}`)).text();
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('Cheapest &lt;script&gt;alert(1)&lt;/script&gt; option');
    expect(html).not.toContain('<i>QS</i>');
    expect(html).toContain('&lt;i&gt;QS&lt;/i&gt;');
  });

  it('says unlimited lines are not stock-limited', async () => {
    const { token } = await hold('QU');
    expect(await (await get(`/approve/${token}`)).text()).toContain('not stock-limited');
  });

  it('after the cut-off it says expired and has no forms; an unknown token is 404', async () => {
    const { token } = await hold('QS');
    await setClock(e, '2026-11-15T17:05:00+02:00');
    const html = await (await get(`/approve/${token}`)).text();
    expect(html).toContain('expired');
    expect(html).not.toContain('<form');
    expect((await get('/approve/nope')).status).toBe(404);
  });

  it('once approved it shows the final state and no forms', async () => {
    const { token } = await hold('QS');
    expect((await (await post(`/approve/${token}`, 'application/json')).json())).toMatchObject({ state: 'ACCEPTED' });
    const html = await (await get(`/approve/${token}`)).text();
    expect(html).toContain('ACCEPTED');
    expect(html).not.toContain('<form');
  });
});

describe('approve and reject results', () => {
  it('the form post gets an HTML result page, the runner gets JSON, a reused token is 409', async () => {
    const a = await hold('QS');
    const res = await post(`/reject/${a.token}`);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('REJECTED');
    expect((await post(`/reject/${a.token}`)).status).toBe(409);
    const b = await hold('QS');
    const ok = await post(`/approve/${b.token}`, 'application/json');
    expect(ok.headers.get('content-type')).toContain('application/json');
    expect(await ok.json()).toMatchObject({ orderId: b.orderId, state: 'ACCEPTED' });
    expect((await post(`/approve/${b.token}`, 'application/json')).status).toBe(409);
    const c = await hold('QS');
    expect(await (await post(`/approve/${c.token}`)).text()).toContain('ACCEPTED');
  });
});

describe('GET /approver/:approverKey', () => {
  it('JSON lists pending approvals with the approval url; HTML has a QR code per approval', async () => {
    const { token, orderId } = await hold('QS');
    const json = await (await get('/approver/ak-a', 'application/json')).json();
    expect(json).toEqual({
      approver: 'Kitchen manager',
      buyerId: 'hotel-a',
      pending: [{ orderId, token, url: `http://localhost/approve/${token}`, netCents: 60000, grossCents: 68100, approvalExpiresAt: '2026-11-15T17:00:00+02:00' }],
    });
    const html = await (await get('/approver/ak-a')).text();
    expect(html).toContain('<title>Lazydoor – approver inbox</title>');
    expect(html).toContain('<svg');
    expect(html).toContain(`/approve/${token}`);
  });

  it('an unknown approver key is 404', async () => {
    expect((await get('/approver/nope', 'application/json')).status).toBe(404);
    const html = await get('/approver/nope');
    expect(html.status).toBe(404);
    expect(html.headers.get('content-type')).toContain('text/html');
  });
});

describe('GET /receipt/:orderId', () => {
  it('serves the plain-text receipt of an order, 404 for an unknown one', async () => {
    const { token, orderId } = await hold('QS');
    await post(`/approve/${token}`, 'application/json');
    const res = await get(`/receipt/${orderId}`, 'text/plain');
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    for (const s of ['QS', '200 × 1 l', 'Net 600.00 EUR', 'Gross 681.00 EUR', 'Approved by Kitchen manager']) expect(text).toContain(s);
    expect((await get('/receipt/nope')).status).toBe(404);
  });

  it('says who rejected an order and why an expired one ended', async () => {
    const a = await hold('QS');
    await post(`/reject/${a.token}`);
    expect(await (await get(`/receipt/${a.orderId}`, 'text/plain')).text()).toContain('Rejected by Kitchen manager');
    const b = await hold('QS');
    await setClock(e, '2026-11-15T17:05:00+02:00');
    await post(`/approve/${b.token}`, 'application/json');
    expect(await (await get(`/receipt/${b.orderId}`, 'text/plain')).text()).toContain('Ended: The approval was not given in time and has expired.');
  });
});
