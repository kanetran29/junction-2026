import { describe, expect, it } from 'vitest';
import { buildQuote, type Draft, type Quote } from '../src/quote/build';
import { REJECTION_PRECEDENCE } from '../src/domain/constants';
import type { CatalogProduct } from '../src/catalog/search';
import { NOW, offersFor, product, type Row } from './quote-helpers';

const draft: Draft = { category: '10400', claims: ['FREE_FROM_LACTOSE'], quantity: { value: 1000, unit: 'l' }, deliverBy: '2026-11-16' };
const meta = { id: 'q1', buyerId: 'hotel-a', draftId: 'd1', now: NOW };

/** Builds a quote from synthetic products and Valio rows. */
function quote(d: Draft, products: CatalogProduct[], rows: Record<string, Row>, extra: { acceptedUnits?: Map<string, number>; brandsNotCarried?: string[] } = {}): Quote {
  return buildQuote({ ...meta, draft: d, products, offers: offersFor(rows), ...extra });
}
const code = (q: Quote, id: string) => q.rejections.find((r) => r.productId === id)?.code;
const ids = (q: Quote) => q.offers.map((o) => o.productId);

describe('buildQuote: the brief example', () => {
  const q = quote(
    draft,
    [product('T1'), product('T2'), product('T3')],
    { T1: { price: 1.01 }, T2: { price: 1.2 }, T3: { price: 0.9, closing: '2026-11-13T20:00:00+02:00' } },
  );
  it('best offer is 1,000 units of the 1 l product at 1,000 x price, gross by tax rate', () => {
    expect(q.offers[0]).toMatchObject({ productId: 'T1', filled: 1000, overage: 0, shortfall: 0, netCents: 101000, grossCents: 114635, closingTime: '2026-11-15T17:00:00+02:00', deliveryDate: '2026-11-16' });
    expect(q.offers[0].lines).toEqual([
      { productId: 'T1', salesUnits: 1000, salesUnit: 'ST', contentPerSalesUnit: 1, contentUnit: 'l', netCentsPerSalesUnit: 101, taxRate: 13.5, deliveryDate: '2026-11-16' },
    ]);
    expect(ids(q)).toEqual(['T1', 'T2']);
  });
  it('a product failing orderable is rejected with its code and is in no offer', () => {
    expect(code(q, 'T3')).toBe('CUTOFF_PASSED');
    expect(q.rejections[0].detail).toContain('cut-off');
  });
  it('carries the quote envelope', () => {
    expect(q).toMatchObject({
      id: 'q1', buyerId: 'hotel-a', draftId: 'd1', createdAt: '2026-11-13T21:10:00+02:00', expiresAt: '2026-11-13T21:40:00+02:00',
      valioCalls: 2, liveValioCalls: 2, replay: false, rankedBy: ['netTotal', 'unitPrice', 'reliability'], understoodAs: draft, notes: [],
      summary: { candidates: 3, offered: 2, rejected: 1, unaccounted: 0 },
    });
    expect(q.offers.map((o) => o.offerId)).toEqual(['o1', 'o2']);
  });
});

describe('buildQuote: ranking', () => {
  it('ranks by net total for the quantity, not by cents per litre', () => {
    const q = quote({ ...draft, quantity: { value: 12, unit: 'l' } }, [product('P1'), product('P2')], { P1: { price: 5, content: 5 }, P2: { price: 1.2 } });
    expect(ids(q)).toEqual(['P2', 'P1']);
    expect(q.offers.map((o) => o.netCents)).toEqual([1440, 1500]);
    expect(q.offers[1]).toMatchObject({ filled: 15, overage: 3 });
  });
  it('breaks a net tie by cents per litre, then by reliability (null last)', () => {
    const q = quote(
      { ...draft, quantity: { value: 10, unit: 'l' } },
      [product('P1', { reliability: 0.92 }), product('P3', { reliability: 0.95 }), product('P4', { reliability: 1 }), product('P5', { reliability: null })],
      { P1: { price: 1.5 }, P3: { price: 5, content: 4 }, P4: { price: 1.5 }, P5: { price: 1.5 } },
    );
    expect(ids(q)).toEqual(['P3', 'P4', 'P1', 'P5']);
  });
  it('offers that cover the quantity rank before partial ones', () => {
    const q = quote(draft, [product('A', { reliability: 1 }), product('B')], { A: { price: 0.1, stock: 10 }, B: { price: 2 } });
    expect(ids(q)).toEqual(['B']);
    expect(code(q, 'A')).toBe('STOCK_LIMITED');
  });
  it('a lot step makes whole lots: 150 kg at 4.4 is 154 kg, at 2.0 is 150 kg', () => {
    const kg = { unit: 'KG' as const, price: 7.7, salesUnit: 'KG' };
    const chicken = { category: '18750', subtype: 'chicken breast fillet', salesUnit: 'KG' };
    const q = quote(
      { category: '18750', subtype: 'chicken breast fillet', claims: [], quantity: { value: 150, unit: 'kg' }, deliverBy: '2026-11-16' },
      [product('C1', { ...chicken, lotStep: 4.4, variableWeight: true }), product('C2', { ...chicken, lotStep: 2 })],
      { C1: { ...kg, stock: 198 }, C2: { ...kg, stock: 1000 } },
    );
    expect(q.offers.map((o) => [o.productId, o.filled, o.netCents, o.estimate])).toEqual([['C2', 150, 115500, false], ['C1', 154, 118580, true]]);
  });
});

describe('buildQuote: subtype and brand', () => {
  it('a product of another subtype is SUBTYPE_MISMATCH; an unverified model tag is kept with a change', () => {
    const q = quote(draft, [product('T1'), product('BAR', { subtype: 'coffee milk' }), product('M1', { subtype: null, tagSource: 'model' })], { T1: {}, BAR: {}, M1: { price: 2 } });
    expect(code(q, 'BAR')).toBe('SUBTYPE_MISMATCH');
    expect(q.offers.find((o) => o.productId === 'M1')?.changes).toContain('SUBTYPE_UNVERIFIED');
    expect(q.offers.find((o) => o.productId === 'T1')?.changes).toEqual([]);
  });
  it('a named subtype overrides the category default', () => {
    const q = quote({ ...draft, subtype: 'coffee milk' }, [product('T1'), product('BAR', { subtype: 'coffee milk' })], { T1: {}, BAR: {} });
    expect(ids(q)).toEqual(['BAR']);
    expect(code(q, 'T1')).toBe('SUBTYPE_MISMATCH');
  });
  it('brand only: others are BRAND_EXCLUDED', () => {
    const q = quote({ ...draft, brand: { rule: 'only', names: ['ARLA'] } }, [product('T1'), product('V1', { brand: 'Valio', brandNorm: 'valio' })], { T1: {}, V1: { price: 0.5 } });
    expect(ids(q)).toEqual(['T1']);
    expect(code(q, 'V1')).toBe('BRAND_EXCLUDED');
  });
  it('brand only with a brand nobody carries: zero offers and a BRAND_NOT_CARRIED note', () => {
    const q = quote({ ...draft, brand: { rule: 'only', names: ['Pirkka'] } }, [product('T1')], { T1: {} }, { brandsNotCarried: ['Pirkka'] });
    expect(q.offers).toEqual([]);
    expect(q.notes).toEqual([{ code: 'BRAND_NOT_CARRIED', detail: expect.stringContaining('Pirkka') }]);
    expect(code(q, 'T1')).toBe('BRAND_EXCLUDED');
  });
  it('brand prefer keeps the others, ranked after, with BRAND_CHANGED', () => {
    const q = quote({ ...draft, brand: { rule: 'prefer', names: ['valio'] } }, [product('T1'), product('V1', { brand: 'Valio', brandNorm: 'valio' })], { T1: { price: 0.5 }, V1: { price: 1 } });
    expect(ids(q)).toEqual(['V1', 'T1']);
    expect(q.offers.map((o) => o.changes.includes('BRAND_CHANGED'))).toEqual([false, true]);
  });
  it('brand prefer with a brand nobody carries: every offer has BRAND_CHANGED', () => {
    const q = quote({ ...draft, brand: { rule: 'prefer', names: ['Pirkka'] } }, [product('T1')], { T1: {} }, { brandsNotCarried: ['Pirkka'] });
    expect(q.offers[0].changes).toContain('BRAND_CHANGED');
  });
});

describe('buildQuote: stock, split and shortfall', () => {
  const A = product('A');
  const B = product('B');
  it('with no single offer covering, one split offer takes the cheapest limited products and is marked SHORTFALL', () => {
    const q = quote(draft, [A, B], { A: { price: 1, stock: 384 }, B: { price: 1.1, stock: 51 } });
    expect(q.offers).toHaveLength(1);
    expect(q.offers[0]).toMatchObject({ productId: null, filled: 435, shortfall: 565, overage: 0, netCents: 38400 + 5610, changes: ['SHORTFALL'] });
    expect(q.offers[0].lines.map((l) => [l.productId, l.salesUnits])).toEqual([['A', 384], ['B', 51]]);
    expect(q.summary).toMatchObject({ candidates: 2, offered: 2, rejected: 0, unaccounted: 0 });
  });
  it('a split that covers the quantity has no shortfall and takes only what it needs', () => {
    const q = quote({ ...draft, quantity: { value: 400, unit: 'l' } }, [A, B], { A: { price: 1, stock: 384 }, B: { price: 1.1, stock: 51 } });
    expect(q.offers[0]).toMatchObject({ filled: 400, shortfall: 0, changes: [] });
    expect(q.offers[0].lines.map((l) => [l.productId, l.salesUnits])).toEqual([['A', 384], ['B', 16]]);
  });
  it('a single product that is short is a one-product partial; accepted lines reduce its stock', () => {
    const q = quote({ ...draft, quantity: { value: 20, unit: 'l' } }, [product('K')], { K: { price: 47.73, content: 5, stock: 6 } }, { acceptedUnits: new Map([['K', 4]]) });
    expect(q.offers[0]).toMatchObject({ productId: 'K', filled: 10, shortfall: 10, netCents: 9546, changes: ['SHORTFALL'] });
  });
  it('a partial take is a whole number of lots', () => {
    const p = product('L', { salesUnit: 'KG', lotStep: 4.4 });
    const q = quote({ ...draft, quantity: { value: 20, unit: 'kg' } }, [p], { L: { unit: 'KG', stock: 10, salesUnit: 'KG' } });
    expect(q.offers[0]).toMatchObject({ filled: 8.8, shortfall: 11.2 });
  });
  it('limited products not used in any offer are STOCK_LIMITED with the amount available', () => {
    const q = quote(draft, [A, B, product('U')], { A: { price: 1, stock: 384 }, B: { price: 1.1, stock: 51 }, U: { price: 2 } });
    expect(ids(q)).toEqual(['U']);
    expect(q.rejections.find((r) => r.productId === 'A')).toMatchObject({ code: 'STOCK_LIMITED', detail: expect.stringContaining('384 available') });
    expect(q.summary).toMatchObject({ candidates: 3, offered: 1, rejected: 2, unaccounted: 0 });
  });
  it('nothing left after accepted lines is STOCK_LIMITED "0 available"', () => {
    const q = quote(draft, [A], { A: { stock: 4 } }, { acceptedUnits: new Map([['A', 4]]) });
    expect(q.offers).toEqual([]);
    expect(q.rejections[0]).toMatchObject({ code: 'STOCK_LIMITED', detail: expect.stringContaining('0 available') });
  });
  it('gross is the sum over tax rates of half-up(net x (1 + rate))', () => {
    const q = quote({ ...draft, quantity: { value: 20, unit: 'l' } }, [A, B], { A: { price: 1, stock: 10, tax: 13.5 }, B: { price: 2, stock: 10, tax: 25.5 } });
    expect(q.offers[0]).toMatchObject({ netCents: 3000, grossCents: 1135 + 2510 });
  });
});

describe('buildQuote: changes, reliability and facts', () => {
  it('PACK_SIZE_CHANGED when packLitres was asked and the content differs', () => {
    const q = quote({ ...draft, packLitres: 10 }, [product('T1'), product('BIG')], { T1: {}, BIG: { price: 9, content: 10 } });
    expect(q.offers.map((o) => [o.productId, o.changes])).toEqual([['BIG', []], ['T1', ['PACK_SIZE_CHANGED']]]);
  });
  it('reliability tri: null unknown, below 0.9 fail, else pass', () => {
    const q = quote(draft, [product('R1', { reliability: null }), product('R2', { reliability: 0.85 }), product('R3', { reliability: 0.9 })], { R1: {}, R2: {}, R3: {} });
    const tri = Object.fromEntries(q.offers.map((o) => [o.productId, o.reliability]));
    expect(tri).toEqual({ R1: { value: null, tri: 'unknown' }, R2: { value: 0.85, tri: 'fail' }, R3: { value: 0.9, tri: 'pass' } });
    expect(q.coverage).toEqual({ reliability: '2 of 3' });
  });
  it('offers carry labels, carbon with its label, and rejections carry labels too', () => {
    const q = quote(draft, [product('T1', { labels: ['EU_ORGANIC_FARMING'], carbon: 1.2 }), product('X', { labels: ['MSC'] })], { T1: {}, X: { closing: null } });
    expect(q.offers[0]).toMatchObject({ labels: ['EU_ORGANIC_FARMING'], carbonKg: 1200, carbonLabel: 'product-group average' });
    expect(q.rejections[0]).toMatchObject({ productId: 'X', labels: ['MSC'] });
  });
  it('carbonKg is null when the product has no carbon value', () => {
    expect(quote(draft, [product('T1', { carbon: null })], { T1: {} }).offers[0].carbonKg).toBeNull();
  });
});

describe('buildQuote: expiry', () => {
  it('is the earliest of the cut-off, the price validTo and 30 minutes', () => {
    const early = quote(draft, [product('T1')], { T1: { closing: '2026-11-13T21:25:00+02:00' } });
    expect(early.expiresAt).toBe('2026-11-13T21:25:00+02:00');
    const priced = quote(draft, [product('T1')], { T1: { validTo: '2026-11-13T21:20:00+02:00' } });
    expect(priced.expiresAt).toBe('2026-11-13T21:20:00+02:00');
    expect(quote(draft, [], {}).expiresAt).toBe('2026-11-13T21:40:00+02:00');
  });
});

describe('buildQuote: rejection precedence and conversion', () => {
  it('publishes the order', () => {
    expect(REJECTION_PRECEDENCE).toEqual(['PRICE_UNAVAILABLE', 'NOT_ORDERABLE', 'SALES_BLOCKED', 'CUTOFF_PASSED', 'DATE_NOT_MET', 'NEW_ALLERGEN', 'CLAIM_MISSING', 'TEMP_CLASS_CHANGED', 'BRAND_EXCLUDED', 'SUBTYPE_MISMATCH', 'NOT_CONVERTIBLE', 'STOCK_LIMITED']);
  });
  it.each<[string, Partial<CatalogProduct>, Row, Partial<Draft>, string]>([
    ['price first', { subtype: 'coffee milk' }, { noPrice: true, closing: null }, {}, 'PRICE_UNAVAILABLE'],
    ['cut-off before date', {}, { closing: '2026-11-13T20:00:00+02:00', availableDate: '2026-11-30' }, {}, 'CUTOFF_PASSED'],
    ['date before brand', { brand: 'Valio', brandNorm: 'valio' }, { availableDate: '2026-11-30' }, { brand: { rule: 'only', names: ['arla'] } }, 'DATE_NOT_MET'],
    ['brand before subtype', { brand: 'Valio', brandNorm: 'valio', subtype: 'coffee milk' }, {}, { brand: { rule: 'only', names: ['arla'] } }, 'BRAND_EXCLUDED'],
    ['subtype before conversion', { subtype: 'coffee milk' }, {}, { quantity: { value: 5, unit: 'pcs' } }, 'SUBTYPE_MISMATCH'],
    ['conversion before stock', {}, { stock: 0.5 }, { quantity: { value: 5, unit: 'pcs' } }, 'NOT_CONVERTIBLE'],
    ['kilos asked of a litre product', {}, {}, { quantity: { value: 5, unit: 'kg' } }, 'NOT_CONVERTIBLE'],
  ])('%s', (_l, p, row, d, expected) => {
    const q = quote({ ...draft, ...d }, [product('X', p)], { X: row });
    expect(q.rejections[0].code).toBe(expected);
  });
  it('pcs on a category need is NOT_CONVERTIBLE for every candidate', () => {
    const q = quote({ ...draft, quantity: { value: 1000, unit: 'pcs' } }, [product('T1')], { T1: {} });
    expect(q.offers).toEqual([]);
    expect(code(q, 'T1')).toBe('NOT_CONVERTIBLE');
  });
});

describe('buildQuote: product list and unknown ids', () => {
  it('an id the catalogue does not know is a typed rejection, not a crash', () => {
    const q = quote({ products: ['999999999'], quantity: { value: 10, unit: 'l' }, deliverBy: '2026-11-16' }, [], {});
    expect(q.offers).toEqual([]);
    expect(q.rejections).toEqual([{ productId: '999999999', code: 'PRICE_UNAVAILABLE', detail: expect.any(String), labels: [] }]);
    expect(q.summary).toEqual({ candidates: 1, offered: 0, rejected: 1, unaccounted: 0 });
  });
  it('candidates are exactly the listed products, with no subtype or claim filter', () => {
    const q = quote({ products: ['BAR'], quantity: { value: 10, unit: 'l' }, deliverBy: '2026-11-16' }, [product('BAR', { subtype: 'coffee milk', claims: [] })], { BAR: {} });
    expect(ids(q)).toEqual(['BAR']);
  });
});

describe('buildQuote: reference product and substitutes', () => {
  const ref = (o: Partial<CatalogProduct> = {}) =>
    product('R', { substitutes: ['S1', 'S2', 'S3', 'S4'], allergens: { contains: ['AM'], mayContain: [], freeFrom: ['AW'] }, ...o });
  const subs = () => [
    product('S1', { allergens: { contains: ['AM'], mayContain: [], freeFrom: [] } }),
    product('S2', { allergens: { contains: ['AM', 'AW'], mayContain: [], freeFrom: [] } }),
    product('S3', { claims: [], allergens: { contains: ['AM'], mayContain: [], freeFrom: [] } }),
    product('S4', { tempClass: 7, allergens: { contains: ['AM'], mayContain: [], freeFrom: [] } }),
  ];
  const rd: Draft = { referenceProduct: 'R', quantity: { value: 50, unit: 'l' }, deliverBy: '2026-11-16', allowSubstitutes: true };
  const rows: Record<string, Row> = { R: { noStock: true }, S1: { price: 1 }, S2: { price: 1 }, S3: { price: 1 }, S4: { price: 1 } };

  it('an unmet reference brings its official substitutes, each checked against it', () => {
    const q = quote(rd, [ref(), ...subs()], rows);
    expect(ids(q)).toEqual(['S1']);
    expect(q.offers[0].changes).toEqual(['SUBSTITUTE']);
    expect(code(q, 'R')).toBe('NOT_ORDERABLE');
    expect(q.rejections.find((r) => r.productId === 'S2')).toMatchObject({ code: 'NEW_ALLERGEN', detail: expect.stringContaining('AW') });
    expect(q.rejections.find((r) => r.productId === 'S3')).toMatchObject({ code: 'CLAIM_MISSING', detail: expect.stringContaining('FREE_FROM_LACTOSE') });
    expect(code(q, 'S4')).toBe('TEMP_CLASS_CHANGED');
    expect(q.summary).toEqual({ candidates: 5, offered: 1, rejected: 4, unaccounted: 0 });
  });
  it('a reference with no allergen data makes the substitute offer carry ALLERGEN_UNKNOWN', () => {
    const q = quote(rd, [ref({ allergens: { contains: [], mayContain: [], freeFrom: [] } }), ...subs()], rows);
    expect(ids(q)).toEqual(['S1', 'S2']);
    expect(q.offers[0].changes).toEqual(['SUBSTITUTE', 'ALLERGEN_UNKNOWN']);
  });
  it('allowSubstitutes false: only the reference is a candidate', () => {
    const q = quote({ ...rd, allowSubstitutes: false }, [ref(), ...subs()], rows);
    expect(q.summary.candidates).toBe(1);
    expect(q.offers).toEqual([]);
  });
  it('a reference that is fully met does not bring substitutes', () => {
    const q = quote(rd, [ref(), ...subs()], { ...rows, R: { price: 2 } });
    expect(ids(q)).toEqual(['R']);
    expect(q.summary.candidates).toBe(1);
    expect(q.offers[0].changes).toEqual([]);
  });
  it('a reference limited below the need brings substitutes; a covering substitute leaves it STOCK_LIMITED', () => {
    const q = quote(rd, [ref(), ...subs()], { ...rows, R: { stock: 10 } });
    expect(ids(q)).toEqual(['S1']);
    expect(code(q, 'R')).toBe('STOCK_LIMITED');
  });
  it('a reference limited below the need with allowSubstitutes false is a partial offer', () => {
    const q = quote({ ...rd, allowSubstitutes: false }, [ref()], { R: { stock: 10 } });
    expect(q.offers[0]).toMatchObject({ productId: 'R', filled: 10, shortfall: 40, changes: ['SHORTFALL'] });
  });
  it('pcs are the reference sales units; a substitute converts through the reference content', () => {
    const q = quote({ ...rd, quantity: { value: 100, unit: 'pcs' } }, [ref({ substitutes: ['S1', 'S5'] }), subs()[0], product('S5')], { R: { noStock: true, price: 2, content: 0.5 }, S1: { price: 1 }, S5: { price: 1, unit: null } });
    expect(q.offers[0]).toMatchObject({ productId: 'S1', filled: 50 });
    expect(q.offers[0].lines[0].salesUnits).toBe(50);
    expect(code(q, 'S5')).toBe('NOT_CONVERTIBLE');
    const direct = quote({ ...rd, quantity: { value: 100, unit: 'pcs' } }, [ref()], { R: { price: 2, content: 0.5 } });
    expect(direct.offers[0].lines[0].salesUnits).toBe(100);
  });
  it('pcs when the reference content is unknown: NOT_CONVERTIBLE', () => {
    const q = quote({ ...rd, quantity: { value: 100, unit: 'pcs' } }, [ref({ substitutes: ['S1'] }), subs()[0]], { R: { noStock: true, price: 2, unit: null }, S1: { price: 1 } });
    expect(code(q, 'S1')).toBe('NOT_CONVERTIBLE');
  });
});
