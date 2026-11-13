import { describe, expect, it } from 'vitest';
import { match } from './matcher';

const reply = {
  state: 'HELD',
  n: 136.4,
  nothing: null,
  draft: { claims: ['FREE_FROM_LACTOSE'], quantity: { value: 1000 } },
  text: 'Total 666.00 EUR',
  paths: { '/v1/quotes': {}, '/v1/orders': {} },
  rejections: [
    { productId: '1', code: 'CUTOFF_PASSED' },
    { productId: 2, code: 'SUBTYPE_MISMATCH' },
    { productId: '3', code: 'CUTOFF_PASSED' },
  ],
  offers: [
    { lines: [{ productId: 'a' }, { productId: 'b' }], netCents: 5 },
    { lines: [{ productId: 'c' }], netCents: 9 },
  ],
};
/** Shorthand: does the sample reply satisfy `[path, op, v]`? */
const ok = (path: string, op: string, v: unknown) => match(reply, [path, op, v]).ok;

describe('match', () => {
  it('= and != with deep equality, tolerance and null', () => {
    expect(ok('state', '=', 'HELD')).toBe(true);
    expect(ok('state', '=', 'ACCEPTED')).toBe(false);
    expect(ok('state', '!=', 'ACCEPTED')).toBe(true);
    expect(ok('n', '=', 136.4000000000001)).toBe(true);
    expect(ok('draft.claims', '=', ['FREE_FROM_LACTOSE'])).toBe(true);
    expect(ok('nothing', '=', null)).toBe(true);
    expect(ok('missing.deep', '=', null)).toBe(true);
    expect(ok('state', '=', null)).toBe(false);
  });
  it('contains / not_contains on arrays and strings', () => {
    expect(ok('draft.claims', 'contains', 'FREE_FROM_LACTOSE')).toBe(true);
    expect(ok('draft.claims', 'not_contains', 'FREE_FROM_LACTOSE')).toBe(false);
    expect(ok('draft.claims', 'not_contains', 'VEGAN')).toBe(true);
    expect(ok('text', 'contains', '666.00')).toBe(true);
    expect(ok('text', 'not_contains', '999')).toBe(true);
    expect(ok('missing', 'contains', 'x')).toBe(false);
    expect(ok('paths', 'contains', '/v1/quotes')).toBe(true);
    expect(ok('paths', 'contains', '/nope')).toBe(false);
    expect(ok('paths', 'not_contains', '/nope')).toBe(true);
    expect(ok('paths', 'not_contains', '/v1/orders')).toBe(false);
  });
  it('numeric and regex ops', () => {
    expect(ok('draft.quantity.value', '>=', 1000)).toBe(true);
    expect(ok('draft.quantity.value', '<=', 999)).toBe(false);
    expect(ok('text', 'matches', '^Total \\d+\\.\\d{2}')).toBe(true);
    expect(ok('state', 'matches', '^A')).toBe(false);
  });
  it('count= on arrays', () => {
    expect(ok('rejections', 'count=', 3)).toBe(true);
    expect(ok('offers[0].lines', 'count=', 3)).toBe(false);
    expect(ok('missing', 'count=', 0)).toBe(false);
  });
  it('index, selector and star paths', () => {
    expect(ok('offers[0].lines[1].productId', '=', 'b')).toBe(true);
    expect(ok('rejections[productId=2].code', '=', 'SUBTYPE_MISMATCH')).toBe(true);
    expect(ok('rejections[code=CUTOFF_PASSED].productId', '=', '1')).toBe(true);
    expect(ok('rejections[*].code', 'contains', 'SUBTYPE_MISMATCH')).toBe(true);
    expect(match(reply, ['offers[*].lines[*].productId', '=', 0]).got).toEqual(['a', 'b', 'c']);
    expect(match(reply, ['offers[*].netCents', '=', 0]).got).toEqual([5, 9]);
    expect(ok('offers[0].lines[*].productId', 'contains', 'b')).toBe(true);
  });
  it('count(...) counts all selector matches', () => {
    expect(ok('count(rejections[code=CUTOFF_PASSED])', '=', 2)).toBe(true);
    expect(ok('count(rejections[code=NOPE])', '=', 0)).toBe(true);
  });
  it('reports got and rejects unknown ops', () => {
    expect(match(reply, ['state', '=', 'X']).got).toBe('HELD');
    expect(() => match(reply, ['state', '??', 'X'])).toThrow();
  });
});
