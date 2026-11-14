import { describe, expect, it } from 'vitest';
import { chooseWithinMandate, fillUnclear } from '../agent/plan';

const mandate = { autoCents: 50000 };
const offer = (offerId: string, netCents: number, extra: Record<string, unknown> = {}) => ({ offerId, netCents, shortfall: 0, changes: [] as string[], ...extra });

describe('chooseWithinMandate', () => {
  it('prefers an offer that stays AUTO when it is within 5 % of the cheapest', () => {
    const picked = chooseWithinMandate([offer('a', 48000, { changes: ['PACK_SIZE_CHANGED'] }), offer('b', 50000)], mandate);
    expect(picked?.offerId).toBe('b');
  });

  it('takes the cheapest when no AUTO offer is within 5 % of it', () => {
    expect(chooseWithinMandate([offer('a', 40000, { changes: ['SUBSTITUTED'] }), offer('b', 50000)], mandate)?.offerId).toBe('a');
    expect(chooseWithinMandate([offer('a', 101000), offer('b', 110000)], mandate)?.offerId).toBe('a');
  });

  it('never picks a partial offer while a covering one exists', () => {
    const picked = chooseWithinMandate([offer('p', 20000, { shortfall: 565, changes: ['SHORTFALL'] }), offer('c', 90000)], mandate);
    expect(picked?.offerId).toBe('c');
  });

  it('falls back to the cheapest partial when nothing covers, and to undefined for no offers', () => {
    expect(chooseWithinMandate([offer('p', 30000, { shortfall: 5 }), offer('q', 20000, { shortfall: 9 })], mandate)?.offerId).toBe('q');
    expect(chooseWithinMandate([], mandate)).toBeUndefined();
  });
});

describe('fillUnclear', () => {
  it('fills fat level "any" and the pack preference from the profile', () => {
    expect(fillUnclear({ unclear: ['fatLevel', 'packLitres'] }, { packLitres: 10 })).toEqual({ fatLevel: 'any', packLitres: 10 });
  });

  it('uses the profile fat level and leaves what it cannot know unfilled', () => {
    expect(fillUnclear({ unclear: ['fatLevel', 'packLitres', 'quantity'] }, { fatLevel: 'low' })).toEqual({ fatLevel: 'low' });
    expect(fillUnclear({ unclear: [] }, { packLitres: 10 })).toEqual({});
  });
});
