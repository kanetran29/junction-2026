import { describe, expect, it } from 'vitest';
import { buildRows, parseNameContent } from '../scripts/build-index';
import { defaultSubtype, tagSubtype } from '../src/catalog/subtypes';
import fixture from './fixtures/products.json';

const rows = buildRows(fixture as never, 'productId,deliveryReliability\nT0001,0.95\nT0005,1.0\n', 'productId,AVG kg CO2-eq/kg\nT0001,2.5\n');
const by = (id: string) => rows.find((r) => r.id === id)!;

describe('buildRows', () => {
  it('maps claims, allergens, labels and sales-unit sizes', () => {
    const m = by('T0001');
    expect(m.claims).toEqual(['FREE_FROM_LACTOSE', 'LOW_FAT']);
    expect(m.allergens).toEqual({ contains: ['AM'], mayContain: [], freeFrom: ['GL'] });
    expect(m.labels).toEqual(['EU_ORGANIC_FARMING']);
    expect(m.unitsPerSales).toBe(1);
    expect(by('T0002').unitsPerSales).toBe(2);
    expect(m.salesUnitGtin).toBe('6400000000011');
    expect(m.substitutes).toEqual(['T0002']);
    expect(by('T0007').allergens).toEqual({ contains: ['AM', 'AN'], mayContain: ['AS'], freeFrom: [] });
  });

  it('keeps lot step and variable weight only when real', () => {
    expect(by('T0001').lotStep).toBeNull();
    expect(by('T0005').lotStep).toBe(4.4);
    expect(by('T0005').variableWeight).toBe(true);
    expect(by('T0001').variableWeight).toBe(false);
  });

  it('joins reliability and carbon, leaving missing as null', () => {
    expect(by('T0001').reliability).toBe(0.95);
    expect(by('T0001').carbon).toBe(2.5);
    expect(by('T0002').reliability).toBeNull();
    expect(by('T0002').carbon).toBeNull();
  });

  it('normalises brand and keeps the most frequent spelling as display', () => {
    expect(by('T0001').brandNorm).toBe('arla');
    expect(by('T0002').brandNorm).toBe('arla');
    expect(by('T0001').brand).toBe('Arla');
    expect(by('T0002').brand).toBe('Arla');
  });

  it('builds the oracle search text without own names or brand', () => {
    expect(by('T0008').searchText).not.toContain('juhla mokka');
    expect(by('T0008').searchText).toContain('party');
    expect(by('T0004').searchText).toContain('buffet');
    expect(by('T0001').searchText).toContain('juhlaan');
    expect(by('T0001').searchText).not.toContain('arla');
  });

  it('tags the three reviewed families and leaves the rest to the model', () => {
    expect([by('T0001').subtype, by('T0001').tagSource]).toEqual(['drinking milk', 'reviewed']);
    expect(by('T0003').subtype).toBe('coffee milk');
    expect(by('T0005').subtype).toBe('chicken breast fillet');
    expect(by('T0006').subtype).toBe('butter');
    expect([by('T0004').subtype, by('T0004').tagSource]).toEqual([null, 'model']);
  });
});

describe('parseNameContent', () => {
  it('parses litres, decilitres, multipacks and kilos', () => {
    expect(parseNameContent('Maito 1 l')).toEqual({ count: 1, size: 1, unit: 'l', total: 1, totalUnit: 'l' });
    expect(parseNameContent('Kerma 2,5 dl')).toEqual({ count: 1, size: 2.5, unit: 'dl', total: 0.25, totalUnit: 'l' });
    expect(parseNameContent('Annosmaito 100x2 cl')).toEqual({ count: 100, size: 2, unit: 'cl', total: 2, totalUnit: 'l' });
    expect(parseNameContent('Filee 10 kg')).toEqual({ count: 1, size: 10, unit: 'kg', total: 10, totalUnit: 'kg' });
    expect(parseNameContent('Voi 500 g')).toEqual({ count: 1, size: 500, unit: 'g', total: 0.5, totalUnit: 'kg' });
    expect(parseNameContent('Ei määrää')).toBeNull();
  });
});

describe('subtype rules (real ids, real names)', () => {
  const t = (c: string, n: string) => tagSubtype(c, n).subtype;
  it('pins the AC03 and AC06 milk names', () => {
    expect(t('10400', 'Valio kahvimaito 1 l laktoositon UHT')).toBe('coffee milk');
    expect(t('10400', 'Arla Cafè maito 1 L UHT laktoositon')).toBe('coffee milk');
    expect(t('10400', 'Valio Eila® rasvaton piimä 1 l laktoositon')).toBe('buttermilk');
    expect(t('10400', 'Arla Annosmaito 100x2 cl laktoositon 1,5% UHT')).toBe('portion milk');
    expect(t('10400', 'Valio Hyvä suomalainen Arki® Eila® kevytmaitojuoma 1 l laktoositon')).toBe('drinking milk');
  });
  it('covers chicken, butter and defaults', () => {
    expect(t('18750', 'Kanan rintafilee')).toBe('chicken breast fillet');
    expect(t('18750', 'Kanan koipi')).toBe('other poultry');
    expect(t('10500', 'Eleplant kasvivoimaa leivälle 500 g')).toBe('plant spread');
    expect(t('10500', 'Valio voi 500 g suolaamaton')).toBe('butter');
    expect(defaultSubtype('10400')).toBe('drinking milk');
    expect(defaultSubtype('18750')).toBeNull();
  });
});
