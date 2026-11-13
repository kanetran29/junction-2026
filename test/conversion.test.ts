import { describe, expect, it } from 'vitest';
import { contentPerSalesUnit, fillQuantity } from '../src/offers/conversion';
import { halfUp, lineNetCents } from '../src/domain/money';
import type { PriceRow } from '../src/valio/client';

const price = (value: number, cmp: number, unit: 'L' | 'KG' | null = 'L') =>
  ({ catalogPrice: { value }, comparisonPrice: { value: cmp }, comparisonUnit: unit }) as unknown as PriceRow;
const name = (total: number, totalUnit: 'l' | 'kg') => ({ nameContent: { count: 1, size: total, unit: totalUnit, total, totalUnit }, unitsPerSales: 1 });
const bare = { nameContent: null, unitsPerSales: null };

describe('contentPerSalesUnit', () => {
  it('snaps 13.32 / 1.332 to the name content of 10 l', () => {
    expect(contentPerSalesUnit(name(10, 'l'), price(13.32, 1.332))).toEqual({ value: 10, unit: 'l' });
  });
  it('multiplies the name content by the pieces per sales unit', () => {
    const p = { nameContent: { count: 1, size: 1, unit: 'l', total: 1, totalUnit: 'l' as const }, unitsPerSales: 12 };
    expect(contentPerSalesUnit(p, price(12, 1))).toEqual({ value: 12, unit: 'l' });
  });
  it('without a usable name snaps to one decimal (4.998 kg -> 5 kg)', () => {
    expect(contentPerSalesUnit(bare, price(4.998, 1, 'KG'))).toEqual({ value: 5, unit: 'kg' });
  });
  it('the ratio off by more than 2 % from the name and from one decimal is NOT convertible', () => {
    expect(contentPerSalesUnit(name(10, 'l'), price(1.23, 10))).toBeNull();
  });
  it('a name that disagrees with a one-decimal ratio still snaps to the ratio', () => {
    expect(contentPerSalesUnit(name(0.115, 'kg'), price(0.96, 4.8, 'KG'))).toEqual({ value: 0.2, unit: 'kg' });
  });
  it('is null without a litre or kilo comparison unit', () => {
    expect(contentPerSalesUnit(bare, price(1, 1, null))).toBeNull();
  });
});

describe('fillQuantity', () => {
  const l20 = { value: 20, unit: 'l' as const };
  it('1,000 l of 20 l cases is 50 sales units with no overage', () => {
    expect(fillQuantity({ value: 1000, unit: 'l' }, l20, null)).toEqual({ salesUnits: 50, filled: 1000, overage: 0 });
  });
  it('rounds up to whole sales units', () => {
    expect(fillQuantity({ value: 1001, unit: 'l' }, l20, null)).toEqual({ salesUnits: 51, filled: 1020, overage: 19 });
  });
  it('150 kg with a lot step of 4.4 kg is 35 lots = 154 sales units, 154 kg', () => {
    expect(fillQuantity({ value: 150, unit: 'kg' }, { value: 1, unit: 'kg' }, 4.4)).toEqual({ salesUnits: 154, filled: 154, overage: 4 });
  });
  it('a lot step counts sales units: lots of 2 units of 5 kg are 10 kg each', () => {
    expect(fillQuantity({ value: 25, unit: 'kg' }, { value: 5, unit: 'kg' }, 2)).toEqual({ salesUnits: 6, filled: 30, overage: 5 });
  });
  it('pcs for a kg product, or litres for a kg product, is NOT_CONVERTIBLE', () => {
    expect(fillQuantity({ value: 5, unit: 'pcs' }, { value: 1, unit: 'kg' }, null)).toEqual({ code: 'NOT_CONVERTIBLE' });
    expect(fillQuantity({ value: 5, unit: 'l' }, { value: 1, unit: 'kg' }, null)).toEqual({ code: 'NOT_CONVERTIBLE' });
  });
});

describe('money', () => {
  it('rounds half up, not half to even', () => {
    expect(halfUp(0.5)).toBe(1);
    expect(halfUp(2.5)).toBe(3);
    expect(halfUp(2.4999)).toBe(2);
  });
  it('net cents = half_up(price cents) x units, half up again', () => {
    expect(lineNetCents(13.32, 50)).toBe(66600);
    expect(lineNetCents(0.965, 3)).toBe(291);
  });
});
