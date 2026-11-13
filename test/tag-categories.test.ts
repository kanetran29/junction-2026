import { describe, expect, it } from 'vitest';
import { parseCategoryTags } from '../scripts/tag-categories';

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
