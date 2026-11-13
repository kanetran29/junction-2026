import { describe, expect, it } from 'vitest';
import { categoriesSql, missingCodes, parseCategoriesSql, parseCategoryTags } from '../scripts/tag-categories';

const known = new Set(['10400', '63235', '22300']);

describe('parseCategoryTags', () => {
  it('keeps known codes, trims names and drops unknown codes', () => {
    const json = [{ category: '10400', name: ' Drinking milk ' }, { category: '99999', name: 'Ghost' }, { category: '63235', name: 'Napkins' }];
    expect(parseCategoryTags(json, known)).toEqual([{ category: '10400', name: 'Drinking milk' }, { category: '63235', name: 'Napkins' }]);
  });

  it('rejects empty, over-long and malformed entries', () => {
    const json = [{ category: '10400', name: '   ' }, { category: '63235', name: 'x'.repeat(41) }, { category: '22300', name: 7 }, null, 'junk'];
    expect(parseCategoryTags(json, known)).toEqual([]);
    expect(parseCategoryTags({ not: 'an array' }, known)).toEqual([]);
  });

  it('de-duplicates by category, first wins', () => {
    const json = [{ category: '22300', name: 'Cheese' }, { category: '22300', name: 'Other' }];
    expect(parseCategoryTags(json, known)).toEqual([{ category: '22300', name: 'Cheese' }]);
  });
});

describe('second pass', () => {
  it('asks only for codes without a row, and the merged result covers them', () => {
    const first = parseCategoryTags([{ category: '10400', name: 'Drinking milk' }], known);
    const missing = missingCodes(known, first);
    expect(missing).toEqual(['63235', '22300']);
    const second = parseCategoryTags([{ category: '63235', name: 'Napkins' }, { category: '22300', name: 'Coffee' }, { category: '10400', name: 'x' }], new Set(missing));
    expect(missingCodes(known, [...first, ...second])).toEqual([]);
  });

  it('round-trips rows through the generated SQL', () => {
    const rows = [{ category: '10400', name: "Baker's milk", tagSource: 'model' as const }];
    expect(parseCategoriesSql(categoriesSql(rows))).toEqual(rows);
  });
});
