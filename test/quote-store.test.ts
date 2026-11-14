import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertStatements } from '../scripts/build-index';
import { setClock } from '../src/clock';
import type { Env } from '../src/env';
import { listEvents } from '../src/events/log';
import { createQuote, getQuote, QuoteError } from '../src/quote/store';
import { fakeValio, product, type Row } from './quote-helpers';
import { db } from '../src/db';

const e = { ...(env as unknown as Env), DEMO_MODE: '1', VALIO_API_KEY: 'test-key' };
const draft = { category: '10400', claims: ['FREE_FROM_LACTOSE'], quantity: { value: 1000, unit: 'l' }, deliverBy: '2026-11-16' };
const rows: Record<string, Row> = { QA: { price: 1.01 }, QB: { price: 1.2 }, QC: { closing: '2026-11-13T20:00:00+02:00' } };

beforeAll(async () => {
  const catalog = [
    product('QA'),
    product('QB'),
    product('QC'),
    product('QD', { claims: [] }),
    product('QV', { brand: 'Valio', brandNorm: 'valio' }),
    product('QR', { claims: [], substitutes: ['QS'], allergens: { contains: ['AM'], mayContain: [], freeFrom: [] } }),
    product('QS', { claims: [], allergens: { contains: ['AM'], mayContain: [], freeFrom: [] } }),
  ];
  await e.DB.batch(insertStatements(catalog).map((s) => e.DB.prepare(s)));
});

beforeEach(async () => {
  for (const t of ['events', 'quotes', 'drafts', 'order_lines', 'orders']) await db(e).prepare(`DELETE FROM ${t}`).run();
  await db(e).prepare("DELETE FROM settings WHERE key = 'replay'").run();
  await setClock(e, '2026-11-13T19:10:00Z');
});

describe('createQuote', () => {
  it('asks Valio once per endpoint about the shortlist only, stores the quote, and the owner can read it back', async () => {
    const v = fakeValio(rows);
    const q = await createQuote(e, 'hotel-a', { draft }, v.fn);
    expect(v.calls.map((c) => c.endpoint).sort()).toEqual(['availability', 'price']);
    expect([...v.calls[0].ids].sort()).toEqual(['QA', 'QB', 'QC', 'QV']);
    expect(q.offers[0]).toMatchObject({ productId: 'QA', netCents: 101000 });
    expect(q).toMatchObject({ buyerId: 'hotel-a', valioCalls: 2, liveValioCalls: 2, summary: { candidates: 4, unaccounted: 0 } });
    expect(await getQuote(e, 'hotel-a', q.id)).toEqual(q);
    expect(await getQuote(e, 'hotel-b', q.id)).toBeNull();
    expect(await getQuote(e, 'hotel-a', 'nope')).toBeNull();
  });

  it('stores a posted draft as confirmed and quotes it again by draftId', async () => {
    const first = await createQuote(e, 'hotel-a', { draft }, fakeValio(rows).fn);
    const row = await db(e).prepare('SELECT body FROM drafts WHERE id = ?').bind(first.draftId).first<{ body: string }>();
    expect(JSON.parse(row!.body)).toMatchObject({ ...draft, status: 'confirmed' });
    const again = await createQuote(e, 'hotel-a', { draftId: first.draftId }, fakeValio(rows).fn);
    expect(again.draftId).toBe(first.draftId);
    expect(again.id).not.toBe(first.id);
  });

  it('refuses an unknown, foreign or unconfirmed draft', async () => {
    const own = await createQuote(e, 'hotel-a', { draft }, fakeValio(rows).fn);
    await expect(createQuote(e, 'hotel-b', { draftId: own.draftId }, fakeValio(rows).fn)).rejects.toMatchObject({ code: 'DRAFT_NOT_FOUND' });
    await db(e).prepare("INSERT INTO drafts(id, buyer_id, body, created_at) VALUES ('d-open','hotel-a',?, 'x')").bind(JSON.stringify({ ...draft, status: 'needs_input' })).run();
    await expect(createQuote(e, 'hotel-a', { draftId: 'd-open' }, fakeValio(rows).fn)).rejects.toMatchObject({ code: 'DRAFT_NOT_CONFIRMED' });
  });

  it('rejects malformed input before any Valio call', async () => {
    const v = fakeValio(rows);
    await expect(createQuote(e, 'hotel-a', { draft: { ...draft, deliverBy: 'Monday' } }, v.fn)).rejects.toThrow();
    await expect(createQuote(e, 'hotel-a', { draft: { ...draft, referenceProduct: 'QR' } }, v.fn)).rejects.toThrow();
    await expect(createQuote(e, 'hotel-a', { draft: { quantity: draft.quantity, deliverBy: '2026-11-16' } }, v.fn)).rejects.toThrow();
    expect(v.calls).toEqual([]);
  });

  it('maps a failing Valio call to UPSTREAM_ERROR', async () => {
    const err = await createQuote(e, 'hotel-a', { draft }, fakeValio(rows, 503).fn).catch((x) => x);
    expect(err).toBeInstanceOf(QuoteError);
    expect(err.code).toBe('UPSTREAM_ERROR');
  });

  it('appends search.done, one valio.called per endpoint, then quote.created, in the documented shapes', async () => {
    const q = await createQuote(e, 'hotel-a', { draft }, fakeValio(rows).fn);
    const ev = await listEvents(e, { since: 0, buyerId: 'hotel-a' });
    expect(ev.map((x) => x.type)).toEqual(['search.done', 'valio.called', 'valio.called', 'quote.created']);
    expect(ev.every((x) => x.quoteId === q.id && x.draftId === q.draftId)).toBe(true);
    expect(ev[0].data).toEqual({ count: 4, categories: ['10400'] });
    expect(ev.slice(1, 3).map((x) => (x.data as { endpoint: string }).endpoint)).toEqual(['availability', 'price']);
    expect(ev[1].data).toMatchObject({ replay: false, ids: expect.arrayContaining(['QA']) });
    expect(ev[3].data).toEqual({
      offers: q.offers.map((o) => ({ offerId: o.offerId, lines: o.lines.map((l) => ({ productId: l.productId, salesUnits: l.salesUnits })), netCents: o.netCents, changes: o.changes })),
      rejections: q.rejections.map((r) => ({ productId: r.productId, code: r.code })),
    });
  });

  it('subtracts accepted lines for the same delivery date from limited stock, and ignores held, other dates', async () => {
    const limited: Record<string, Row> = { QA: { price: 1, stock: 600 } };
    /** Inserts an order row for the lines below. */
    const order = async (id: string, state: string) => db(e).prepare("INSERT INTO orders(id, buyer_id, state, body, created_at) VALUES (?, 'hotel-b', ?, '{}', 'x')").bind(id, state).run();
    await order('o1', 'ACCEPTED');
    await order('o2', 'HELD');
    /** Inserts one order line of QA for hotel-b. */
    const line = (o: string, units: number, date: string, state: string) =>
      db(e).prepare("INSERT INTO order_lines(order_id, buyer_id, product_id, delivery_date, sales_units, state) VALUES (?, 'hotel-b', 'QA', ?, ?, ?)").bind(o, date, units, state).run();
    await line('o1', 100, '2026-11-16', 'ACCEPTED');
    await line('o1', 50, '2026-11-17', 'ACCEPTED');
    await line('o2', 70, '2026-11-16', 'HELD');
    const q = await createQuote(e, 'hotel-a', { draft }, fakeValio(limited).fn);
    expect(q.offers[0]).toMatchObject({ productId: 'QA', filled: 500, shortfall: 500 });
  });

  it('a product list asks about exactly those ids, and an unknown id is a typed rejection', async () => {
    const v = fakeValio({ QA: { price: 1 } });
    const q = await createQuote(e, 'hotel-a', { products: ['QA', '999999999'], quantity: { value: 10, unit: 'l' }, deliverBy: '2026-11-16' }, v.fn);
    expect(v.calls[0].ids).toEqual(['QA', '999999999']);
    expect(q.offers.map((o) => o.productId)).toEqual(['QA']);
    expect(q.rejections).toMatchObject([{ productId: '999999999', code: 'PRICE_UNAVAILABLE' }]);
  });

  it('a reference need fetches the reference and its substitutes in one call', async () => {
    const v = fakeValio({ QR: { noStock: true }, QS: { price: 1 } });
    const q = await createQuote(e, 'hotel-a', { draft: { referenceProduct: 'QR', quantity: { value: 50, unit: 'l' }, deliverBy: '2026-11-16', allowSubstitutes: true } }, v.fn);
    expect(v.calls).toHaveLength(2);
    expect(v.calls[0].ids.sort()).toEqual(['QR', 'QS']);
    expect(q.offers[0]).toMatchObject({ productId: 'QS', changes: ['SUBSTITUTE'] });
  });

  it('reports a brand the catalogue does not carry', async () => {
    const q = await createQuote(e, 'hotel-a', { draft: { ...draft, brand: { rule: 'only', names: ['Pirkka'] } } }, fakeValio(rows).fn);
    expect(q.offers).toEqual([]);
    expect(q.notes.map((n) => n.code)).toEqual(['BRAND_NOT_CARRIED']);
    const arla = await createQuote(e, 'hotel-a', { draft: { ...draft, brand: { rule: 'only', names: ['ARLA'] } } }, fakeValio(rows).fn);
    expect(arla.notes).toEqual([]);
    expect(arla.offers.length).toBeGreaterThan(0);
  });
});
