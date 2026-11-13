import { describe, expect, it } from 'vitest';
import { isUnlimited, orderable } from '../src/offers/orderable';
import { withIsoOffsets, type AvailabilityRow, type PriceRow } from '../src/valio/client';
import fixture from './fixtures/valio-replies.json';

const fx = withIsoOffsets(fixture as never) as typeof fixture;
const av = (id: string) => fx.availability[0].products.find((p) => p.productId === id) as unknown as AvailabilityRow;
const pr = (id: string) => fx.price[0].products.find((p) => p.productId === id) as unknown as PriceRow;
const NOW = new Date('2026-11-13T21:10:00+02:00');
const run = (id: string, now = NOW, deliverBy = '2026-11-16', salesUnit: string | null = 'ST') =>
  orderable(av(id), pr(id), now, deliverBy, { salesUnit });

describe('orderable', () => {
  it.each([
    ['Terminal 999999 past its cut-off', 'T0002', 'CUTOFF_PASSED'],
    ['no schedule lines', 'T0003', 'NOT_ORDERABLE'],
    ['price error with null catalogPrice', 'T0005', 'PRICE_UNAVAILABLE'],
    ['product salesBlock', 'T0006', 'SALES_BLOCKED'],
    ['amount 0', 'T0007', 'NOT_ORDERABLE'],
    ['available after deliverBy', 'T0008', 'DATE_NOT_MET'],
  ])('%s -> %s', (_label, id, code) => {
    const r = run(id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });

  it('cut-off exactly now is passed, one second earlier is open', () => {
    const closing = new Date(av('T0001').closingTime!);
    const at = orderable(av('T0001'), pr('T0001'), closing, '2026-11-16', { salesUnit: 'ST' });
    expect(at.ok === false && at.code).toBe('CUTOFF_PASSED');
    expect(orderable(av('T0001'), pr('T0001'), new Date(closing.getTime() - 1000), '2026-11-16', { salesUnit: 'ST' }).ok).toBe(true);
  });

  it('stock open and unlimited: no limit, normalised closing time and delivery date', () => {
    expect(run('T0001')).toEqual({ ok: true, limit: null, closingTime: '2026-11-15T17:00:00+02:00', deliveryDate: '2026-11-16' });
  });

  it('limited stock keeps its amount; blocked lines do not count', () => {
    expect(run('T0004')).toMatchObject({ ok: true, limit: 384 });
    expect(run('T0009')).toMatchObject({ ok: true, limit: 7 });
  });

  it('a missing price row is PRICE_UNAVAILABLE and an expired catalog price too', () => {
    const none = orderable(av('T0001'), undefined, NOW, '2026-11-16', { salesUnit: 'ST' });
    expect(none.ok === false && none.code).toBe('PRICE_UNAVAILABLE');
    const stale = { ...pr('T0001'), catalogPrice: { ...pr('T0001').catalogPrice!, validTo: '2026-11-01T00:00:00+02:00' } };
    const r = orderable(av('T0001'), stale, NOW, '2026-11-16', { salesUnit: 'ST' });
    expect(r.ok === false && r.code).toBe('PRICE_UNAVAILABLE');
  });

  it('a zero catalog price, a price error with a valid price, and a null price without an error are all PRICE_UNAVAILABLE', () => {
    const base = pr('T0001');
    const zero = { ...base, catalogPrice: { ...base.catalogPrice!, value: 0 } };
    const errored = { ...base, error: true };
    const none = { ...base, catalogPrice: null, error: false };
    for (const bad of [zero, errored, none]) {
      const r = orderable(av('T0001'), bad, NOW, '2026-11-16', { salesUnit: 'ST' });
      expect(r.ok === false && r.code).toBe('PRICE_UNAVAILABLE');
    }
  });

  it('ignores a schedule line in another sales unit and names both units', () => {
    const r = run('T0001', NOW, '2026-11-16', 'KG');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('NOT_ORDERABLE');
      expect(r.detail).toContain('ST');
      expect(r.detail).toContain('KG');
    }
  });
});

describe('isUnlimited', () => {
  it.each([
    [1e10, true],
    [15, false],
    [999999, true],
    [999998, false],
  ])('%s -> %s', (amount, unlimited) => expect(isUnlimited(amount)).toBe(unlimited));
});
