import type { CatalogProduct } from '../src/catalog/search';
import type { AvailabilityRow, Offers, PriceRow } from '../src/valio/client';

export const NOW = new Date('2026-11-13T21:10:00+02:00');
export const CLOSING = '2026-11-15T17:00:00+02:00';

/** A synthetic drinking-milk product: Arla, lactose-free, reviewed subtype, reliability 1, carbon 1.2; overrides replace any field. */
export function product(id: string, o: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id,
    category: '10400',
    subtype: 'drinking milk',
    tagSource: 'reviewed',
    names: [{ language: 'fi', value: `Tuote ${id}` }],
    salesUnit: 'ST',
    baseUnit: 'ST',
    unitsPerSales: 1,
    lotStep: null,
    tempClass: 4,
    claims: ['FREE_FROM_LACTOSE'],
    allergens: { contains: [], mayContain: [], freeFrom: [] },
    labels: [],
    brand: 'Arla',
    brandNorm: 'arla',
    salesUnitGtin: null,
    gtin: null,
    units: [],
    origin: null,
    reliability: 1,
    carbon: 1.2,
    substitutes: [],
    variableWeight: false,
    nameContent: null,
    searchText: '',
    ...o,
  };
}

export interface Row {
  /** Euros per sales unit. */
  price?: number;
  /** Litres or kilos per sales unit (default 1). */
  content?: number;
  unit?: 'L' | 'KG' | null;
  /** Stock in sales units; null or omitted is unlimited. */
  stock?: number | null;
  closing?: string | null;
  tax?: number;
  validTo?: string;
  blocked?: boolean;
  noPrice?: boolean;
  noStock?: boolean;
  availableDate?: string;
  /** The sales unit of the schedule line (default ST). */
  salesUnit?: string;
}

/** Valio-shaped Offers for synthetic rows keyed by product id, as `fetchOffers` would return them. */
export function offersFor(rows: Record<string, Row>, extra: Partial<Offers> = {}): Offers {
  const availability = new Map<string, AvailabilityRow>();
  const price = new Map<string, PriceRow>();
  for (const [id, r] of Object.entries(rows)) {
    availability.set(id, {
      productId: id,
      closingTime: r.closing === undefined ? CLOSING : r.closing,
      salesBlock: Boolean(r.blocked),
      logisticModel: null,
      scheduleLines: r.noStock ? [] : [{ salesBlock: false, availableAmount: r.stock ?? 999999, availableDate: r.availableDate ?? '2026-11-16', salesUnit: r.salesUnit ?? 'ST' }],
    });
    const p = r.price ?? 1;
    const c = r.content ?? 1;
    price.set(id, {
      productId: id,
      quantity: 1,
      catalogPrice: r.noPrice ? null : { value: p, validTo: r.validTo ?? '2026-12-31T00:00:00+02:00' },
      comparisonPrice: r.noPrice ? null : { value: p / c },
      comparisonUnit: r.noPrice ? null : r.unit === undefined ? 'L' : r.unit,
      tax: r.noPrice ? null : { taxRate: r.tax ?? 13.5, taxValue: 0 },
      listPrice: null,
      netPriceFound: !r.noPrice,
      error: Boolean(r.noPrice),
    });
  }
  return { availability, price, calls: 2, liveCalls: 2, replay: false, timeNow: '2026-11-13T21:10:00+02:00', ids: Object.keys(rows), ...extra };
}

/** A fake Valio fetch answering the availability and price endpoints from synthetic rows, recording each call's endpoint and ids. */
export function fakeValio(rows: Record<string, Row>, status = 200) {
  const calls: { endpoint: string; ids: string[] }[] = [];
  const o = offersFor(rows);
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    const endpoint = String(url).split('/').pop() as 'availability' | 'price';
    const ids = JSON.parse(init?.body as string).products as string[];
    calls.push({ endpoint, ids });
    if (status !== 200) return new Response('no', { status });
    const map = (endpoint === 'availability' ? o.availability : o.price) as Map<string, unknown>;
    return new Response(JSON.stringify({ timeNow: '2026-11-13T21:10:00+0200', products: ids.filter((id) => map.has(id)).map((id) => map.get(id)) }));
  };
  return { fn: fn as unknown as typeof fetch, calls };
}
