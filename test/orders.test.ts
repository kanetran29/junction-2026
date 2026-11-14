import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertStatements } from '../scripts/build-index';
import { setClock } from '../src/clock';
import type { Env } from '../src/env';
import { listEvents } from '../src/events/log';
import { seedMandate } from '../src/mandate/jws';
import { approve, approverInbox, createBasket, getOrder, OrderError, placeOrder, reject } from '../src/orders/store';
import { sha256Hex } from '../src/util';
import { createQuote } from '../src/quote/store';
import { fakeValio, product, type Row } from './quote-helpers';
import { db } from '../src/db';

const e = { ...(env as unknown as Env), DEMO_MODE: '1', VALIO_API_KEY: 'test-key' };
const day = '2026-11-16';
/** A product-list need for `litres` of one product, delivered by the test day. */
const need = (id: string, litres: number) => ({ products: [id], quantity: { value: litres, unit: 'l' as const }, deliverBy: day });
const rows: Record<string, Row> = { QA: { price: 1.01 }, QB: { price: 1.2 }, QG: { price: 10, tax: 25.5 }, QL: { price: 1, stock: 6 }, QM: { price: 1, stock: 200 }, QX: { price: 1, closing: '2026-11-13T20:00:00+02:00' } };
const valio = fakeValio(rows).fn;
let n = 0;
/** A fresh idempotency key. */
const key = () => `k${++n}`;

/** Quotes one need for a buyer against the synthetic Valio rows. */
const quote = (buyer: string, id: string, litres: number, r: Record<string, Row> = rows) => createQuote(e, buyer, need(id, litres), fakeValio(r).fn);
/** Places offer o1 of a quote with a fresh idempotency key. */
const place = (buyer: string, quoteId: string, r: Record<string, Row> = rows, extra: { idempotencyKey?: string; offerId?: string } = {}) =>
  placeOrder(e, { buyerId: buyer, idempotencyKey: extra.idempotencyKey ?? key(), quoteId, offerId: extra.offerId ?? 'o1' }, fakeValio(r).fn);
/** The approval token of a buyer's only HELD order, read from the approver inbox as the approver would. */
const tokenOf = async (buyer = 'hotel-a') => (await approverInbox(e, buyer === 'hotel-a' ? 'ak-a' : 'ak-b')).pending[0].token;
/** The error a promise rejects with, or null when it resolves. */
const errOf = (p: Promise<unknown>) => p.then(() => null, (x: unknown) => x as OrderError);
/** How many ledger lines exist (for one buyer, or all). */
const lineCount = async (buyer?: string) =>
  (await db(e).prepare(`SELECT COUNT(*) AS c FROM order_lines WHERE (?1::text IS NULL OR buyer_id = ?1)`).bind(buyer ?? null).first<{ c: number }>())!.c;

beforeAll(async () => {
  await e.DB.batch(insertStatements(['QA', 'QB', 'QG', 'QL', 'QM', 'QX'].map((id) => product(id, id === 'QG' ? { claims: [] } : {}))).map((s) => e.DB.prepare(s)));
  for (const b of ['hotel-a', 'hotel-b']) await seedMandate(e, b);
  await db(e).prepare("DELETE FROM approver_keys").run();
  for (const [k, b] of [['ak-a', 'hotel-a'], ['ak-b', 'hotel-b']]) {
    await db(e).prepare('INSERT INTO approver_keys(key_hash, buyer_id, approver) VALUES (?,?,?)').bind(await sha256Hex(k), b, 'Kitchen manager').run();
  }
});

beforeEach(async () => {
  for (const t of ['events', 'quotes', 'drafts', 'baskets', 'order_lines', 'orders']) await db(e).prepare(`DELETE FROM ${t}`).run();
  await db(e).prepare("DELETE FROM settings WHERE key = 'replay'").run();
  await setClock(e, '2026-11-13T19:10:00Z');
});

describe('placeOrder: input and idempotency', () => {
  it('needs an idempotency key (400), a known quote of the buyer (404) and an offer of that quote (400)', async () => {
    const q = await quote('hotel-a', 'QA', 20);
    expect(await errOf(placeOrder(e, { buyerId: 'hotel-a', idempotencyKey: '', quoteId: q.id, offerId: 'o1' }, valio))).toMatchObject({ status: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(await errOf(place('hotel-b', q.id))).toMatchObject({ status: 404 });
    expect(await errOf(place('hotel-a', 'nope'))).toMatchObject({ status: 404 });
    expect(await errOf(place('hotel-a', q.id, rows, { offerId: 'o9' }))).toMatchObject({ status: 400, code: 'OFFER_NOT_IN_QUOTE' });
    expect((await db(e).prepare('SELECT COUNT(*) AS c FROM orders').first<{ c: number }>())!.c).toBe(0);
  });

  it('the same key twice is the same order and the stored reply; the same key with another body is 422', async () => {
    const q = await quote('hotel-a', 'QA', 20);
    const first = await place('hotel-a', q.id, rows, { idempotencyKey: 'dup' });
    const again = await place('hotel-a', q.id, rows, { idempotencyKey: 'dup' });
    expect(again).toEqual(first);
    expect((await db(e).prepare("SELECT COUNT(*) AS c FROM orders WHERE idempotency_key = 'dup'").first<{ c: number }>())!.c).toBe(1);
    const other = await quote('hotel-a', 'QB', 20);
    expect(await errOf(place('hotel-a', other.id, rows, { idempotencyKey: 'dup' }))).toMatchObject({ status: 422 });
    expect(await lineCount()).toBe(1);
  });

  it('two concurrent places with one key make one order; the loser is 409 or the same reply', async () => {
    const q = await quote('hotel-a', 'QA', 20);
    const res = await Promise.allSettled([place('hotel-a', q.id, rows, { idempotencyKey: 'race' }), place('hotel-a', q.id, rows, { idempotencyKey: 'race' })]);
    expect((await db(e).prepare("SELECT COUNT(*) AS c FROM orders WHERE idempotency_key = 'race'").first<{ c: number }>())!.c).toBe(1);
    const ok = res.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of res) if (r.status === 'rejected') expect(r.reason).toMatchObject({ status: 409 });
    expect(await lineCount()).toBe(1);
  });

  it('a failed placement frees the key (nothing was decided)', async () => {
    const q = await quote('hotel-a', 'QA', 20);
    expect(await errOf(place('hotel-a', q.id, rows, { idempotencyKey: 'again', offerId: 'o9' }))).toMatchObject({ status: 400 });
    expect((await place('hotel-a', q.id, rows, { idempotencyKey: 'again' })).state).toBe('ACCEPTED');
  });
});

describe('placeOrder: the state machine', () => {
  it('AUTO under the mandate is ACCEPTED with lines in the ledger and the documented reply', async () => {
    const q = await quote('hotel-a', 'QA', 20);
    const r = await place('hotel-a', q.id);
    expect(r).toMatchObject({
      state: 'ACCEPTED',
      decision: { outcome: 'AUTO', reasons: [] },
      approval: { status: 'none' },
      order: { id: r.orderId, state: 'ACCEPTED', netCents: 2020, unmet: [], deliveryDate: day },
    });
    expect(r.order.lines).toEqual(q.offers[0].lines);
    expect(await lineCount('hotel-a')).toBe(1);
    expect((await getOrder(e, 'hotel-a', r.orderId))?.state).toBe('ACCEPTED');
    expect(await getOrder(e, 'hotel-b', r.orderId)).toBeNull();
  });

  it('NEEDS_APPROVAL is HELD: no lines, approver named, and no token or URL anywhere in the reply', async () => {
    const q = await quote('hotel-a', 'QA', 1000);
    const r = await place('hotel-a', q.id, rows, { idempotencyKey: 'held' });
    expect(r).toMatchObject({ state: 'HELD', decision: { outcome: 'NEEDS_APPROVAL' }, approval: { status: 'pending', approver: 'Kitchen manager' }, order: { netCents: 101000, grossCents: 114635 } });
    expect(r.decision.reasons.map((x) => x.code)).toContain('OVER_ORDER_AUTO');
    expect(await lineCount()).toBe(0);
    const token = await tokenOf();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const text = JSON.stringify([r, await getOrder(e, 'hotel-a', r.orderId), await placeOrder(e, { buyerId: 'hotel-a', idempotencyKey: 'held', quoteId: q.id, offerId: 'o1' }, valio)]);
    expect(text).not.toContain(token);
    expect(text).not.toMatch(/https?:|approvalUrl|"token"/);
  });

  it('the token is bound to every line, the buyer and the mandate version by a sha256', async () => {
    const q = await quote('hotel-a', 'QA', 1000);
    const r = await place('hotel-a', q.id);
    const l = q.offers[0].lines[0];
    const canon = JSON.stringify({
      lines: [{ productId: l.productId, salesUnits: l.salesUnits, unit: l.salesUnit, netCentsPerSalesUnit: l.netCentsPerSalesUnit, taxRate: l.taxRate, deliveryDate: l.deliveryDate }],
      buyerId: 'hotel-a',
      mandateVersion: 1,
    });
    const row = await db(e).prepare('SELECT lines_hash FROM orders WHERE id = ?').bind(r.orderId).first<{ lines_hash: string }>();
    expect(row!.lines_hash).toBe(await sha256Hex(canon));
  });

  it('an expired quote is REJECTED QUOTE_EXPIRED', async () => {
    const q = await quote('hotel-a', 'QA', 20);
    await setClock(e, '2026-11-13T20:00:00Z');
    const r = await place('hotel-a', q.id);
    expect(r).toMatchObject({ state: 'REJECTED', decision: { outcome: 'REJECT', reasons: [{ code: 'QUOTE_EXPIRED' }] } });
    expect(await lineCount()).toBe(0);
  });

  it('a tampered or expired mandate REJECTS every order for the buyer', async () => {
    const q = await quote('hotel-b', 'QA', 20);
    await seedMandate(e, 'hotel-b', {}, { tamper: true });
    expect((await place('hotel-b', q.id)).decision.reasons.map((x) => x.code)).toContain('MANDATE_INVALID');
    await db(e).prepare("DELETE FROM mandates WHERE buyer_id = 'hotel-b'").run();
    await seedMandate(e, 'hotel-b', { exp: '2026-11-13T21:00:00+02:00' });
    const r = await place('hotel-b', q.id);
    expect(r).toMatchObject({ state: 'REJECTED' });
    expect(r.decision.reasons.map((x) => x.code)).toContain('MANDATE_EXPIRED');
    await db(e).prepare("DELETE FROM mandates WHERE buyer_id = 'hotel-b'").run();
    await seedMandate(e, 'hotel-b');
  });

  it('over the hard limit is REJECTED OVER_ORDER_HARD', async () => {
    const q = await quote('hotel-a', 'QA', 5000);
    const r = await place('hotel-a', q.id);
    expect(r.state).toBe('REJECTED');
    expect(r.decision.reasons.map((x) => x.code)).toContain('OVER_ORDER_HARD');
  });

  it('two sequential orders that together cross the day limit: the second is HELD with OVER_DAY_AUTO', async () => {
    const a = await place('hotel-a', (await quote('hotel-a', 'QA', 396)).id);
    const b = await place('hotel-a', (await quote('hotel-a', 'QA', 396)).id);
    expect([a.state, b.state]).toEqual(['ACCEPTED', 'HELD']);
    expect(b.decision.reasons.map((x) => x.code)).toContain('OVER_DAY_AUTO');
  });

  it('every step appends events in the documented shapes and none carries the token', async () => {
    const q = await quote('hotel-a', 'QA', 1000);
    const r = await place('hotel-a', q.id);
    const token = await tokenOf();
    await approve(e, token, { callerRole: 'approver' }, valio);
    const ev = (await listEvents(e, { since: 0, buyerId: 'hotel-a' })).filter((x) => x.orderId === r.orderId);
    expect(ev.map((x) => x.type)).toEqual(['policy.decided', 'approval.requested', 'valio.called', 'valio.called', 'approval.approved', 'order.accepted']);
    expect(ev[0].data).toMatchObject({ outcome: 'NEEDS_APPROVAL', reasons: expect.arrayContaining(['OVER_ORDER_AUTO']) });
    expect(ev[1].data).toEqual({ orderId: r.orderId, expiresAt: '2026-11-15T17:00:00+02:00' });
    expect(ev[5].data).toEqual({ lines: q.offers[0].lines, netCents: 101000 });
    expect(JSON.stringify(ev)).not.toContain(token);
  });

  it('multi-rate baskets gross per VAT rate', async () => {
    const b = await createBasket(e, 'hotel-a', [need('QA', 100), need('QG', 2)], valio);
    const r = await placeOrder(e, { buyerId: 'hotel-a', idempotencyKey: key(), basketId: b.basketId, selections: b.quotes.map((q) => ({ quoteId: q.id, offerId: 'o1' })) }, valio);
    // 10100 at 13.5 % -> 11463.5 -> 11464 (half up); 2000 at 25.5 % -> 2510
    expect(r.order).toMatchObject({ netCents: 12100, grossCents: 11464 + 2510 });
  });
});

describe('stuck idempotency keys', () => {
  it('a committed order whose reply was never written is rebuilt on retry, not 409 forever', async () => {
    const q = await quote('hotel-a', 'QA', 20);
    const first = await place('hotel-a', q.id, rows, { idempotencyKey: 'lost' });
    await db(e).prepare("UPDATE orders SET reply = NULL WHERE idempotency_key = 'lost'").run();
    const again = await place('hotel-a', q.id, rows, { idempotencyKey: 'lost' });
    expect(again).toEqual(first);
    expect(await lineCount()).toBe(1);
    expect((await db(e).prepare("SELECT reply FROM orders WHERE idempotency_key = 'lost'").first<{ reply: string | null }>())!.reply).not.toBeNull();
  });

  it('a lost STOCK_TAKEN reply is rebuilt with available', async () => {
    const [qa, qb] = [await quote('hotel-a', 'QL', 4), await quote('hotel-b', 'QL', 4)];
    await place('hotel-b', qb.id);
    const first = await place('hotel-a', qa.id, rows, { idempotencyKey: 'lost2' });
    await db(e).prepare("UPDATE orders SET reply = NULL WHERE idempotency_key = 'lost2'").run();
    expect(await place('hotel-a', qa.id, rows, { idempotencyKey: 'lost2' })).toEqual(first);
  });

  it('a PLACING row is 409 while fresh and is swept after 60 s so the retry proceeds', async () => {
    const q = await quote('hotel-a', 'QA', 20);
    await db(e).prepare("INSERT INTO orders(id, buyer_id, quote_id, idempotency_key, request_hash, state, body, created_at) VALUES ('dead','hotel-a',?, 'stale', ?, 'PLACING', '{}', '2026-11-13T21:10:00+02:00')")
      .bind(q.id, await sha256Hex(JSON.stringify([q.id, 'o1', null, null, null])))
      .run();
    await setClock(e, '2026-11-13T19:10:30Z');
    expect(await errOf(place('hotel-a', q.id, rows, { idempotencyKey: 'stale' }))).toMatchObject({ status: 409 });
    await setClock(e, '2026-11-13T19:11:30Z');
    expect((await place('hotel-a', q.id, rows, { idempotencyKey: 'stale' })).state).toBe('ACCEPTED');
    expect(await db(e).prepare("SELECT id FROM orders WHERE id = 'dead'").first()).toBeNull();
  });
});

describe('the stock ledger (first authorised order wins)', () => {
  it('two concurrent 399.96 places for one buyer: one ACCEPTED, one HELD (day total re-checked in the batch)', async () => {
    const [q1, q2] = await Promise.all([quote('hotel-a', 'QA', 396), quote('hotel-a', 'QA', 396)]);
    const res = await Promise.all([place('hotel-a', q1.id), place('hotel-a', q2.id)]);
    expect(res.map((r) => r.state).sort()).toEqual(['ACCEPTED', 'HELD']);
    const held = res.find((r) => r.state === 'HELD')!;
    expect(held.decision.reasons.map((x) => x.code)).toContain('OVER_DAY_AUTO');
    expect(held.approval).toMatchObject({ status: 'pending' });
    expect(await lineCount()).toBe(1);
    const logged = (await listEvents(e, { since: 0 })).filter((x) => x.type === 'policy.decided' && x.orderId === held.orderId);
    expect(logged[0].data).toMatchObject({ outcome: 'NEEDS_APPROVAL', reasons: ['OVER_DAY_AUTO'] });
  });

  it('20 concurrent places of 4 units on a 6-unit product: exactly one ACCEPTED, the rest STOCK_TAKEN', async () => {
    const quotes = await Promise.all(Array.from({ length: 20 }, () => quote('hotel-a', 'QL', 4)));
    const res = await Promise.all(quotes.map((q) => place('hotel-a', q.id)));
    const states = res.map((r) => r.state);
    expect(states.filter((s) => s === 'ACCEPTED')).toHaveLength(1);
    const lost = res.filter((r) => r.state === 'REJECTED');
    expect(lost).toHaveLength(19);
    for (const r of lost) {
      expect(r).toMatchObject({ available: 2, retryable: false, resolution: 'requote', decision: { outcome: 'REJECT' } });
      expect(r.decision.reasons.find((x) => x.code === 'STOCK_TAKEN')?.detail).toContain('QL');
    }
    expect(await lineCount()).toBe(1);
    const stock = (await listEvents(e, { since: 0 })).filter((x) => x.type === 'stock.denied');
    expect(stock).toHaveLength(19);
    expect(stock[0].data).toEqual({ productId: 'QL', remaining: 2 });
  });

  it('a quote reserves nothing: the second buyer to place wins nothing back after the first took the stock', async () => {
    const [qa, qb] = [await quote('hotel-a', 'QL', 4), await quote('hotel-b', 'QL', 4)];
    expect((await place('hotel-b', qb.id)).state).toBe('ACCEPTED');
    expect(await place('hotel-a', qa.id)).toMatchObject({ state: 'REJECTED', available: 2 });
  });

  it('a basket with one short line commits nothing', async () => {
    const b = await createBasket(e, 'hotel-a', [need('QA', 20), need('QL', 4)], valio);
    const taken = await place('hotel-b', (await quote('hotel-b', 'QL', 4)).id);
    expect(taken.state).toBe('ACCEPTED');
    const r = await placeOrder(e, { buyerId: 'hotel-a', idempotencyKey: key(), basketId: b.basketId, selections: b.quotes.map((q) => ({ quoteId: q.id, offerId: 'o1' })) }, valio);
    expect(r).toMatchObject({ state: 'REJECTED', available: 2, retryable: false, resolution: 'requote' });
    expect(r.decision.reasons.find((x) => x.code === 'STOCK_TAKEN')?.detail).toContain('QL');
    expect(await lineCount('hotel-a')).toBe(0);
    expect(await lineCount('hotel-b')).toBe(1);
  });

  it('two lines of one product in a basket are checked together against the limit', async () => {
    const b = await createBasket(e, 'hotel-a', [need('QL', 4), need('QL', 4)], valio);
    const r = await placeOrder(e, { buyerId: 'hotel-a', idempotencyKey: key(), basketId: b.basketId, selections: b.quotes.map((q) => ({ quoteId: q.id, offerId: 'o1' })) }, valio);
    expect(r).toMatchObject({ state: 'REJECTED', available: 6 });
    expect(await lineCount()).toBe(0);
    const roomy = { ...rows, QL: { price: 1, stock: 8 } };
    const b2 = await createBasket(e, 'hotel-a', [need('QL', 4), need('QL', 4)], fakeValio(roomy).fn);
    const ok = await placeOrder(e, { buyerId: 'hotel-a', idempotencyKey: key(), basketId: b2.basketId, selections: b2.quotes.map((q) => ({ quoteId: q.id, offerId: 'o1' })) }, fakeValio(roomy).fn);
    expect(ok.state).toBe('ACCEPTED');
    expect(await lineCount()).toBe(2);
  });

  it('a partial basket is HELD PARTIAL_BASKET with the unmet need and its quote code', async () => {
    const b = await createBasket(e, 'hotel-a', [need('QA', 20), need('QX', 20)], valio);
    expect(b.quotes[1].offers).toEqual([]);
    const r = await placeOrder(e, { buyerId: 'hotel-a', idempotencyKey: key(), basketId: b.basketId, selections: [{ quoteId: b.quotes[0].id, offerId: 'o1' }] }, valio);
    expect(r).toMatchObject({ state: 'HELD', order: { unmet: [{ code: 'CUTOFF_PASSED' }] } });
    expect(r.decision.reasons.map((x) => x.code)).toContain('PARTIAL_BASKET');
    expect(r.order.lines).toHaveLength(1);
    const left = await createBasket(e, 'hotel-a', [need('QA', 20), need('QB', 20)], valio);
    const skipped = await placeOrder(e, { buyerId: 'hotel-a', idempotencyKey: key(), basketId: left.basketId, selections: [{ quoteId: left.quotes[0].id, offerId: 'o1' }] }, valio);
    expect(skipped.order.unmet).toMatchObject([{ code: 'NOT_SELECTED' }]);
  });

  it('a basket expires with its earliest quote and a selection must come from the basket', async () => {
    const b = await createBasket(e, 'hotel-a', [need('QA', 20), need('QB', 20)], valio);
    expect(b.expiresAt).toBe(b.quotes.map((q) => q.expiresAt).sort()[0]);
    const stray = await quote('hotel-a', 'QA', 20);
    expect(await errOf(placeOrder(e, { buyerId: 'hotel-a', idempotencyKey: key(), basketId: b.basketId, selections: [{ quoteId: stray.id, offerId: 'o1' }] }, valio))).toMatchObject({ status: 400 });
    expect(await errOf(placeOrder(e, { buyerId: 'hotel-b', idempotencyKey: key(), basketId: b.basketId, selections: [] }, valio))).toMatchObject({ status: 404 });
  });
});

describe('approval', () => {
  /** A HELD order of 1000 litres of QA for hotel-a. */
  const held = async () => (await place('hotel-a', (await quote('hotel-a', 'QA', 1000)).id)).orderId;

  it('the approver accepts: ACCEPTED, lines enter the ledger, the token works once (409 after)', async () => {
    const id = await held();
    const token = await tokenOf();
    const inbox = await approverInbox(e, 'ak-a');
    expect(inbox).toMatchObject({ approver: 'Kitchen manager', buyerId: 'hotel-a', pending: [{ orderId: id, token, netCents: 101000, grossCents: 114635, approvalExpiresAt: '2026-11-15T17:00:00+02:00' }] });
    expect((await approverInbox(e, 'ak-b')).pending).toEqual([]);
    expect(await approve(e, token, { callerRole: 'approver' }, valio)).toEqual({ orderId: id, state: 'ACCEPTED' });
    expect(await lineCount('hotel-a')).toBe(1);
    expect((await approverInbox(e, 'ak-a')).pending).toEqual([]);
    expect(await errOf(approve(e, token, { callerRole: 'approver' }, valio))).toMatchObject({ status: 409 });
    expect(await errOf(approve(e, 'unknown-token', { callerRole: 'approver' }, valio))).toMatchObject({ status: 404 });
    expect(await lineCount('hotel-a')).toBe(1);
  });

  it('two concurrent approvals of one token: one ACCEPTED, one 409, one set of lines', async () => {
    await held();
    const token = await tokenOf();
    const res = await Promise.allSettled([approve(e, token, { callerRole: 'approver' }, valio), approve(e, token, { callerRole: 'approver' }, valio)]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(res.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    expect(await lineCount('hotel-a')).toBe(1);
  });

  it('only the approver role may approve or reject: anything else is 403 and the order stays HELD', async () => {
    const id = await held();
    const token = await tokenOf();
    for (const callerRole of ['agent', undefined, 'admin'] as never[]) {
      expect(await errOf(approve(e, token, { callerRole }, valio))).toMatchObject({ status: 403 });
      expect(await errOf(reject(e, token, { callerRole }))).toMatchObject({ status: 403 });
    }
    expect(await errOf(approve(e, token, undefined as never, valio))).toMatchObject({ status: 403 });
    expect((await getOrder(e, 'hotel-a', id))?.state).toBe('HELD');
  });

  it('an agent key gets 403 and the order stays HELD', async () => {
    const id = await held();
    const token = await tokenOf();
    expect(await errOf(approve(e, token, { callerRole: 'agent' }, valio))).toMatchObject({ status: 403 });
    expect((await getOrder(e, 'hotel-a', id))?.state).toBe('HELD');
    expect(await lineCount()).toBe(0);
  });

  it('after the cut-off the order is EXPIRED APPROVAL_EXPIRED and places nothing', async () => {
    const id = await held();
    const token = await tokenOf();
    await setClock(e, '2026-11-15T15:05:00Z');
    expect(await approve(e, token, { callerRole: 'approver' }, valio)).toEqual({ orderId: id, state: 'EXPIRED', reason: 'APPROVAL_EXPIRED' });
    expect(await getOrder(e, 'hotel-a', id)).toMatchObject({ state: 'EXPIRED', reason: 'APPROVAL_EXPIRED' });
    expect(await lineCount()).toBe(0);
    const ev = (await listEvents(e, { since: 0 })).map((x) => x.type);
    expect(ev).toContain('approval.expired');
  });

  it('a price that changed while held is EXPIRED PRICE_CHANGED', async () => {
    await held();
    const token = await tokenOf();
    const dearer = { ...rows, QA: { price: 1.111 } };
    expect(await approve(e, token, { callerRole: 'approver' }, fakeValio(dearer).fn)).toMatchObject({ state: 'EXPIRED', reason: 'PRICE_CHANGED' });
    expect(await lineCount()).toBe(0);
  });

  it('stock Valio no longer shows is EXPIRED STOCK_TAKEN with nothing available', async () => {
    await held();
    const token = await tokenOf();
    const gone = { ...rows, QA: { price: 1.01, noStock: true } };
    expect(await approve(e, token, { callerRole: 'approver' }, fakeValio(gone).fn)).toMatchObject({ state: 'EXPIRED', reason: 'STOCK_TAKEN', available: 0 });
  });

  it('a Valio cut-off that passed while held is APPROVAL_EXPIRED; another orderable failure keeps its own code', async () => {
    const id = await held();
    const token = await tokenOf();
    const late = { ...rows, QA: { price: 1.01, closing: '2026-11-13T09:00:00+02:00' } };
    expect(await approve(e, token, { callerRole: 'approver' }, fakeValio(late).fn)).toMatchObject({ orderId: id, state: 'EXPIRED', reason: 'APPROVAL_EXPIRED' });
    await held();
    const blocked = { ...rows, QA: { price: 1.01, blocked: true } };
    expect(await approve(e, await tokenOf(), { callerRole: 'approver' }, fakeValio(blocked).fn)).toMatchObject({ state: 'EXPIRED', reason: 'SALES_BLOCKED' });
  });

  it('approval is not a reservation: stock taken meanwhile is EXPIRED STOCK_TAKEN with what is left', async () => {
    const dear = { ...rows, QM: { price: 4, stock: 200 } };
    const heldA = await place('hotel-a', (await quote('hotel-a', 'QM', 150, dear)).id, dear);
    expect(heldA.state).toBe('HELD');
    const tokenA = await tokenOf('hotel-a');
    const b = await place('hotel-b', (await quote('hotel-b', 'QM', 60, dear)).id, dear);
    expect(b.state).toBe('ACCEPTED');
    expect(await approve(e, tokenA, { callerRole: 'approver' }, fakeValio(dear).fn)).toEqual({ orderId: heldA.orderId, state: 'EXPIRED', reason: 'STOCK_TAKEN', available: 140 });
    expect(await lineCount('hotel-a')).toBe(0);
    expect((await listEvents(e, { since: 0 })).filter((x) => x.type === 'stock.denied').at(-1)?.data).toEqual({ productId: 'QM', remaining: 140 });
  });

  it('a held order whose lines no longer match the token binding is 409 and stays HELD', async () => {
    const id = await held();
    const token = await tokenOf();
    const row = await db(e).prepare('SELECT body FROM orders WHERE id = ?').bind(id).first<{ body: string }>();
    const body = JSON.parse(row!.body);
    body.lines[0].salesUnits = 1;
    await db(e).prepare('UPDATE orders SET body = ? WHERE id = ?').bind(JSON.stringify(body), id).run();
    expect(await errOf(approve(e, token, { callerRole: 'approver' }, valio))).toMatchObject({ status: 409 });
    expect((await getOrder(e, 'hotel-a', id))?.state).toBe('HELD');
  });

  it('reject ends the order REJECTED once', async () => {
    const id = await held();
    const token = await tokenOf();
    expect(await reject(e, token, { callerRole: 'approver' })).toEqual({ orderId: id, state: 'REJECTED' });
    expect(await errOf(reject(e, token, { callerRole: 'approver' }))).toMatchObject({ status: 409 });
    expect(await errOf(approve(e, token, { callerRole: 'approver' }, valio))).toMatchObject({ status: 409 });
    expect(await errOf(reject(e, 'nope', { callerRole: 'approver' }))).toMatchObject({ status: 404 });
    expect((await listEvents(e, { since: 0 })).map((x) => x.type)).toContain('approval.rejected');
  });

  it('an unknown approver key has no inbox', async () => {
    expect(await errOf(approverInbox(e, 'wrong'))).toMatchObject({ status: 401 });
  });
});
