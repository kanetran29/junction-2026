import { describe, expect, it } from 'vitest';
import { checkSubstitute } from '../src/policy/substitute';
import { product } from './quote-helpers';

const a = (contains: string[], freeFrom: string[] = []) => ({ contains, mayContain: [], freeFrom });

describe('checkSubstitute', () => {
  const ref = product('R', { claims: ['FREE_FROM_LACTOSE', 'LOW_FAT'], allergens: a(['AM']), tempClass: 4 });
  it('accepts an equivalent product', () => {
    expect(checkSubstitute(ref, product('S', { claims: ['FREE_FROM_LACTOSE', 'LOW_FAT', 'VEGAN'], allergens: a(['AM']) }))).toEqual({ ok: true, allergensUnknown: false });
  });
  it('a new CONTAINS allergen is NEW_ALLERGEN and names the codes', () => {
    expect(checkSubstitute(ref, product('S', { claims: ref.claims, allergens: a(['AM', 'AW', 'GO']) }))).toEqual({ ok: false, code: 'NEW_ALLERGEN', detail: 'adds allergen AW, GO' });
  });
  it('a lost claim is CLAIM_MISSING and names it', () => {
    expect(checkSubstitute(ref, product('S', { claims: ['LOW_FAT'], allergens: a(['AM']) }))).toEqual({ ok: false, code: 'CLAIM_MISSING', detail: 'lacks FREE_FROM_LACTOSE' });
  });
  it('another temperature class is TEMP_CLASS_CHANGED; an unknown class on either side is not a change', () => {
    expect(checkSubstitute(ref, product('S', { claims: ref.claims, allergens: a(['AM']), tempClass: 7 }))).toMatchObject({ ok: false, code: 'TEMP_CLASS_CHANGED' });
    expect(checkSubstitute(ref, product('S', { claims: ref.claims, allergens: a(['AM']), tempClass: null }))).toMatchObject({ ok: true });
  });
  it('allergen before claim before temperature when several fail', () => {
    expect(checkSubstitute(ref, product('S', { claims: [], allergens: a(['AW']), tempClass: 7 }))).toMatchObject({ code: 'NEW_ALLERGEN' });
    expect(checkSubstitute(ref, product('S', { claims: [], allergens: a(['AM']), tempClass: 7 }))).toMatchObject({ code: 'CLAIM_MISSING' });
  });
  it('a reference with no allergen data cannot be compared: ok but allergensUnknown', () => {
    const bare = product('R', { claims: [], allergens: a([]) });
    expect(checkSubstitute(bare, product('S', { claims: [], allergens: a(['AW']) }))).toEqual({ ok: true, allergensUnknown: true });
  });
});
