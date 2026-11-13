import { describe, expect, it } from 'vitest';
import { renderReceipt } from '../src/receipt/render';
import type { Order } from '../src/orders/store';
import type { Draft, OfferLine } from '../src/quote/build';
import type { Decision } from '../src/policy/decide';
import { product } from './quote-helpers';

const line = (productId: string, salesUnits: number, cents: number, content = 1, unit: 'l' | 'kg' = 'l'): OfferLine => ({
  productId, salesUnits, salesUnit: 'ST', contentPerSalesUnit: content, contentUnit: unit, netCentsPerSalesUnit: cents, taxRate: 13.5, deliveryDate: '2026-11-16',
});
const order = (lines: OfferLine[], netCents: number, grossCents: number, state: Order['state'] = 'ACCEPTED'): Order => ({ id: 'ord_1', state, lines, unmet: [], netCents, grossCents, deliveryDate: '2026-11-16' });
const draft: Draft = { category: '10400', quantity: { value: 1000, unit: 'l' }, deliverBy: '2026-11-16' };
const held: Decision = { outcome: 'NEEDS_APPROVAL', reasons: [{ code: 'OVER_ORDER_AUTO' }] };
const products = [product('464306', { names: [{ language: 'fi', value: 'Maitojuoma <b>1 l' }] }), product('464411'), product('472673')];
const opts = { products, approver: 'Kitchen manager' };

describe('renderReceipt', () => {
  it('shows the brief example: product, units, price per litre, totals, reason text and who approved', () => {
    const text = renderReceipt(order([line('464306', 1000, 101)], 101000, 114635), [], [draft], held, opts);
    for (const s of ['464306', '1,000 × 1 l', '1.01 EUR/l', '1,010.00', 'Net 1,010.00 EUR', 'Gross 1,146.35 EUR', 'ACCEPTED', 'Approved by Kitchen manager', 'binding order, invoiced on delivery (simulated)']) expect(text).toContain(s);
    expect(text).toContain('The order exceeds the automatic limit per order, so a human must approve it.');
  });

  it('an order inside the mandate says so', () => {
    const text = renderReceipt(order([line('464306', 20, 101)], 2020, 2293), [], [draft], { outcome: 'AUTO', reasons: [] }, opts);
    expect(text).toContain('accepted within the mandate');
    expect(text).not.toContain('Approved by');
  });

  it('a basket receipt lists every line and the basket totals', () => {
    const lines = [line('464306', 300, 101), line('464411', 20, 660, 1, 'kg'), line('472673', 30, 770, 1, 'kg')];
    const text = renderReceipt(order(lines, 66600, 75591), [], [draft], held, opts);
    for (const s of ['464306', '464411', '472673', '666.00', '755.91', '303.00', '132.00', '231.00']) expect(text).toContain(s);
  });

  it('names the requested and delivered pack when the pack size changed', () => {
    const d: Decision = { outcome: 'NEEDS_APPROVAL', reasons: [{ code: 'PACK_SIZE_CHANGED' }] };
    const text = renderReceipt(order([line('464306', 100, 500, 5)], 50000, 56750), [], [{ ...draft, packLitres: 1 }], d, opts);
    expect(text).toContain('pack requested 1 l, delivered 5 l');
    expect(text).toContain('100 × 5 l');
  });

  it('a held or rejected order is not called binding and shows the state', () => {
    const h = renderReceipt(order([line('464306', 1000, 101)], 101000, 114635, 'HELD'), [], [draft], held, opts);
    expect(h).toContain('HELD');
    expect(h).toContain('Waiting for approval by Kitchen manager');
    expect(h).not.toContain('binding order');
    const r = renderReceipt(order([line('464306', 1000, 101)], 101000, 114635, 'REJECTED'), [], [draft], { outcome: 'REJECT', reasons: [{ code: 'OVER_ORDER_HARD' }] }, opts);
    expect(r).toContain('REJECTED');
    expect(r).toContain('hard limit per order');
  });
});
