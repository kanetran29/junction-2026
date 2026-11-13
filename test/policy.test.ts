import { describe, expect, it } from 'vitest';
import { defaultMandate } from '../src/domain/constants';
import { decide } from '../src/policy/decide';
import type { Draft, Offer } from '../src/quote/build';
import { product } from './quote-helpers';

const mandate = defaultMandate('hotel-a');
const draft: Draft = { category: '10400', claims: ['FREE_FROM_LACTOSE'], quantity: { value: 1, unit: 'l' }, deliverBy: '2026-11-16' };

/** A synthetic offer of one line of product `id` whose net total is `netCents`. */
function offer(netCents: number, o: Partial<Offer> = {}, id = 'QA'): Offer {
  return {
    offerId: 'o1',
    productId: id,
    lines: [{ productId: id, salesUnits: 1, salesUnit: 'ST', contentPerSalesUnit: 1, contentUnit: 'l', netCentsPerSalesUnit: netCents, taxRate: 13.5, deliveryDate: '2026-11-16' }],
    filled: 1,
    overage: 0,
    shortfall: 0,
    netCents,
    grossCents: netCents,
    centsPerContentUnit: netCents,
    closingTime: '2026-11-15T17:00:00+02:00',
    deliveryDate: '2026-11-16',
    reliability: { value: 1, tri: 'pass' },
    labels: [],
    carbonKg: null,
    carbonLabel: 'product-group average',
    estimate: false,
    changes: [],
    ...o,
  };
}

/** Runs decide with defaults: one offer, one draft, the default mandate and a day with nothing booked. */
function run(offers: Offer[], o: Partial<Parameters<typeof decide>[0]> = {}) {
  return decide({
    offers,
    drafts: offers.map(() => draft),
    unmet: [],
    mandate,
    dayCommittedCents: 0,
    dayPendingCents: 0,
    products: [product('QA'), product('QB'), product('QC')],
    ...o,
  });
}
const codes = (d: ReturnType<typeof decide>) => d.reasons.map((r) => r.code);

describe('decide', () => {
  it('450 EUR is AUTO with no reasons', () => {
    expect(run([offer(45000)])).toEqual({ outcome: 'AUTO', reasons: [] });
  });
  it('1,010 EUR needs approval for OVER_ORDER_AUTO (and OVER_DAY_AUTO)', () => {
    const d = run([offer(101000)]);
    expect(d.outcome).toBe('NEEDS_APPROVAL');
    expect(codes(d)).toEqual(['OVER_ORDER_AUTO', 'OVER_DAY_AUTO']);
  });
  it('6,000 EUR is REJECT OVER_ORDER_HARD', () => {
    const d = run([offer(600000)]);
    expect(d.outcome).toBe('REJECT');
    expect(codes(d)).toContain('OVER_ORDER_HARD');
  });
  it('committed 400 + 400 crosses the day auto limit: NEEDS_APPROVAL OVER_DAY_AUTO only', () => {
    const d = run([offer(40000)], { dayCommittedCents: 40000 });
    expect(d).toMatchObject({ outcome: 'NEEDS_APPROVAL' });
    expect(codes(d)).toEqual(['OVER_DAY_AUTO']);
  });
  it('held (pending) orders count towards the day too', () => {
    expect(codes(run([offer(40000)], { dayPendingCents: 40000 }))).toEqual(['OVER_DAY_AUTO']);
  });
  it('a day total above 10,000 EUR is REJECT OVER_DAY_HARD', () => {
    const d = run([offer(100000)], { dayCommittedCents: 950000 });
    expect(d.outcome).toBe('REJECT');
    expect(codes(d)).toContain('OVER_DAY_HARD');
  });
  it('limits compare the basket total: three lines under 500 each, 666 in all, is OVER_ORDER_AUTO', () => {
    const d = run([offer(30300, {}, 'QA'), offer(13200, {}, 'QB'), offer(23100, {}, 'QC')]);
    expect(d.outcome).toBe('NEEDS_APPROVAL');
    expect(codes(d)).toContain('OVER_ORDER_AUTO');
  });
  it('an unmet need is PARTIAL_BASKET', () => {
    const d = run([offer(1000)], { unmet: [{ need: draft, code: 'CUTOFF_PASSED', detail: 'x' }] });
    expect(d).toMatchObject({ outcome: 'NEEDS_APPROVAL' });
    expect(codes(d)).toEqual(['PARTIAL_BASKET']);
  });
  it('unknown reliability: allow stays AUTO, approve asks a human', () => {
    const unknown = offer(1000, { reliability: { value: null, tri: 'unknown' } });
    expect(run([unknown])).toEqual({ outcome: 'AUTO', reasons: [] });
    expect(codes(run([unknown], { mandate: { ...mandate, reliabilityUnknown: 'approve' } }))).toEqual(['RELIABILITY_UNKNOWN']);
  });
  it('reliability below the floor is RELIABILITY_LOW', () => {
    expect(codes(run([offer(1000, { reliability: { value: 0.5, tri: 'fail' } })]))).toEqual(['RELIABILITY_LOW']);
    expect(codes(run([offer(1000, { reliability: { value: 0.95, tri: 'pass' } })], { mandate: { ...mandate, reliabilityFloor: 0.99 } }))).toEqual(['RELIABILITY_LOW']);
  });
  it.each(['PACK_SIZE_CHANGED', 'SUBSTITUTE', 'SHORTFALL', 'SUBTYPE_UNVERIFIED', 'ALLERGEN_UNKNOWN'] as const)('change %s needs approval with that code', (c) => {
    const d = run([offer(1000, { changes: [c] })]);
    expect(d).toMatchObject({ outcome: 'NEEDS_APPROVAL' });
    expect(codes(d)).toEqual([c]);
  });
  it('BRAND_CHANGED is a flag only', () => {
    expect(run([offer(1000, { changes: ['BRAND_CHANGED'] })])).toEqual({ outcome: 'AUTO', reasons: [] });
  });
  it('an expired mandate is REJECT MANDATE_EXPIRED', () => {
    const d = run([offer(1000)], { now: new Date('2026-11-16T00:00:00+02:00') });
    expect(d.outcome).toBe('REJECT');
    expect(codes(d)).toEqual(['MANDATE_EXPIRED']);
  });
  it('a product missing a claim the draft requires is REJECT CLAIM_MISSING naming it', () => {
    const d = run([offer(1000, {}, 'QX')], { products: [product('QX', { claims: [] })] });
    expect(d.outcome).toBe('REJECT');
    expect(d.reasons[0]).toMatchObject({ code: 'CLAIM_MISSING' });
    expect(d.reasons[0].detail).toContain('QX');
  });
  it('NEW_ALLERGEN in changes rejects under noNewAllergen and only asks a human otherwise', () => {
    const o = offer(1000, { changes: ['NEW_ALLERGEN'] });
    expect(run([o]).outcome).toBe('REJECT');
    expect(run([o], { mandate: { ...mandate, noNewAllergen: false } }).outcome).toBe('NEEDS_APPROVAL');
  });
  it('reasons accumulate and REJECT wins over NEEDS_APPROVAL', () => {
    const d = run([offer(101000, { changes: ['SUBSTITUTE', 'NEW_ALLERGEN'] })]);
    expect(d.outcome).toBe('REJECT');
    expect(codes(d)).toEqual(expect.arrayContaining(['OVER_ORDER_AUTO', 'OVER_DAY_AUTO', 'SUBSTITUTE', 'NEW_ALLERGEN']));
  });
});
