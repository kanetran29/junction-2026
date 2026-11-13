import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildRows, insertStatements } from '../scripts/build-index';
import { getByGtin, getProducts, searchProducts } from '../src/catalog/search';
import type { Env } from '../src/env';
import fixture from './fixtures/products.json';

const e = env as unknown as Env;

beforeAll(async () => {
  const rows = buildRows(fixture as never, 'productId,deliveryReliability\n', 'productId,AVG kg CO2-eq/kg\n');
  await e.DB.batch(insertStatements(rows).map((s) => e.DB.prepare(s)));
});

const ids = (ps: { id: string }[]) => ps.map((p) => p.id).sort();

describe('searchProducts', () => {
  it('returns lactose-free milks of 10400 and not the chocolate', async () => {
    expect(ids(await searchProducts(e, { category: '10400', claims: ['FREE_FROM_LACTOSE'] }))).toEqual(['T0001', 'T0002', 'T0003']);
  });
  it('requires all claims and filters by subtype and temperature class', async () => {
    expect(ids(await searchProducts(e, { category: '10400', claims: ['FREE_FROM_LACTOSE', 'LOW_FAT'] }))).toEqual(['T0001']);
    expect(ids(await searchProducts(e, { category: '10400', claims: [], subtype: 'coffee milk' }))).toEqual(['T0003']);
    expect(ids(await searchProducts(e, { category: '10400', claims: [], tempClasses: [1, 2] }))).toEqual([]);
    expect(ids(await searchProducts(e, { category: '10400', claims: [], tempClasses: [4] }))).toEqual(['T0001', 'T0002', 'T0003']);
  });
  it('brand only filters; no brand rule does not', async () => {
    const f = { category: '10400', claims: ['FREE_FROM_LACTOSE'] };
    expect(ids(await searchProducts(e, { ...f, brand: { rule: 'only', names: ['arla'] } }))).toEqual(['T0001', 'T0002']);
    expect(ids(await searchProducts(e, { ...f, brand: { rule: 'prefer', names: ['Arla'] } }))).toEqual(['T0001', 'T0002', 'T0003']);
  });
});

describe('lookups', () => {
  it('getProducts returns parsed rows', async () => {
    const [p] = await getProducts(e, ['T0001']);
    expect(p.claims).toContain('FREE_FROM_LACTOSE');
    expect(p.names[0].value).toContain('Arla');
    expect(await getProducts(e, [])).toEqual([]);
    const many = [...Array.from({ length: 250 }, (_, i) => `X${i}`), 'T0003', 'T0001'];
    expect((await getProducts(e, many)).map((p) => p.id)).toEqual(['T0001', 'T0003']);
  });
  it('getByGtin matches sales-unit GTINs only', async () => {
    expect(ids(await getByGtin(e, '6400000000011'))).toEqual(['T0001']);
    expect(await getByGtin(e, '6400000000103')).toEqual([]);
  });
});
