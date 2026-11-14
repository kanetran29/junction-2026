import { getSetting, replayOn } from '../clock';
import type { Env } from '../env';
import { halfUp } from '../domain/money';

export interface ScheduleLine {
  salesBlock: boolean;
  availableAmount: number;
  availableDate: string;
  salesUnit: string;
}

export interface AvailabilityRow {
  productId: string;
  closingTime: string | null;
  salesBlock: boolean;
  logisticModel: string | null;
  scheduleLines: ScheduleLine[];
}

interface Money {
  value: number | null;
  valueWithTax?: number;
  validFrom?: string;
  validTo?: string;
  currency?: string;
}

export interface PriceRow {
  productId: string;
  quantity: number;
  catalogPrice: Money | null;
  comparisonPrice: Money | null;
  comparisonUnit: 'L' | 'KG' | null;
  tax: { taxRate: number; taxValue: number } | null;
  listPrice: Money | null;
  netPriceFound: boolean;
  error: boolean;
}

export interface Offers {
  availability: Map<string, AvailabilityRow>;
  price: Map<string, PriceRow>;
  /** Logical Valio calls: two per started 1,000 ids (availability and price), the same live or replayed. */
  calls: number;
  /** Calls that really went over the network; 0 in replay. */
  liveCalls: number;
  replay: boolean;
  /** The ids asked of both endpoints, for the caller's `valio.called` events. */
  ids: string[];
}

/** A Valio call that failed (network error or non-200); the quote builder turns it into UPSTREAM_ERROR. */
export class ValioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValioError';
  }
}

const BATCH = 1000;
const DEFAULT_RECORDING = 'replies_2026-11-16';

/**
 * Rewrites every `+0200`-style offset in timestamp strings to `+02:00`, deeply, so replies compare and parse the same
 * in every runtime. Date-only values and strings that are not timestamps are left alone.
 */
export function withIsoOffsets<T>(x: T): T {
  if (typeof x === 'string') return x.replace(/^(\d{4}-\d\d-\d\dT[\d:.]+[+-]\d\d)(\d\d)$/, '$1:$2') as T;
  if (Array.isArray(x)) return x.map(withIsoOffsets) as T;
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, withIsoOffsets(v)])) as T;
  return x;
}

/** The mock's answer for a product it does not know: 200 with no schedule lines and a price error. */
function unknown(id: string): { av: AvailabilityRow; price: PriceRow } {
  return {
    av: { productId: id, closingTime: null, salesBlock: false, logisticModel: null, scheduleLines: [] },
    price: { productId: id, quantity: 1, catalogPrice: null, comparisonPrice: null, comparisonUnit: null, tax: null, listPrice: null, netPriceFound: false, error: true },
  };
}

/** A price raised by 10 %, rounded half up to the cent (the `price_plus_10pct` replay variant); null and undefined stay as they are. */
const plus10 = (v: number | null | undefined) => (typeof v === 'number' ? halfUp(Math.round(v * 110 * 1e6) / 1e6) / 100 : v);

/** Applies a demo variant to one product's recorded rows: `out_of_stock` empties its schedule, `price_plus_10pct` raises its prices 10 %. */
function applyVariant(variant: string | undefined, av: AvailabilityRow, price: PriceRow): void {
  if (variant === 'out_of_stock') av.scheduleLines = [];
  if (variant === 'price_plus_10pct') {
    for (const m of [price.catalogPrice, price.comparisonPrice]) {
      if (m) {
        m.value = plus10(m.value) ?? null;
        m.valueWithTax = plus10(m.valueWithTax) ?? undefined;
      }
    }
  }
}

/** Serves the recorded replies from `valio_replies` (recording and variants come from settings), with unknown ids answered like the mock. */
async function replayOffers(env: Env, ids: string[]): Promise<Pick<Offers, 'availability' | 'price'>> {
  const recording = (await getSetting(env, 'recording')) ?? DEFAULT_RECORDING;
  const variants = JSON.parse((await getSetting(env, 'variants')) ?? '{}') as Record<string, string>;
  const { results } = await env.DB.prepare(
    'SELECT kind, product_id, body FROM valio_replies WHERE recording = ? AND product_id IN (SELECT value FROM json_each(?))',
  )
    .bind(recording, JSON.stringify(ids))
    .all<{ kind: string; product_id: string; body: string }>();
  const rows = { availability: new Map<string, AvailabilityRow>(), price: new Map<string, PriceRow>() };
  for (const r of results) {
    rows[r.kind as 'availability' | 'price'].set(r.product_id, JSON.parse(r.body));
  }
  for (const id of ids) {
    const fallback = unknown(id);
    const av = rows.availability.get(id) ?? fallback.av;
    const price = rows.price.get(id) ?? fallback.price;
    applyVariant(variants[id], av, price);
    rows.availability.set(id, withIsoOffsets(av));
    rows.price.set(id, withIsoOffsets(price));
  }
  return rows;
}

/**
 * Posts one batch of up to 1,000 ids to a Valio endpoint and returns its reply. Any failure becomes a ValioError:
 * a network error, a non-200, a body that is not JSON, or a reply without a `products` array.
 */
async function post(env: Env, endpoint: 'availability' | 'price', ids: string[], date: string, fetchFn: typeof fetch): Promise<{ timeNow: string; products: unknown[] }> {
  try {
    const res = await fetchFn(`${env.VALIO_API_BASE}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'X-API-Key': env.VALIO_API_KEY, 'User-Agent': 'lazydoor/0.1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer: 'lazydoor', requestedDate: date, products: ids }),
    });
    if (!res.ok) throw new ValioError(`${endpoint} returned ${res.status}`);
    const body = (await res.json()) as { timeNow: string; products: unknown[] } | null;
    if (!body || !Array.isArray(body.products)) throw new ValioError(`${endpoint} reply has no products`);
    return withIsoOffsets(body);
  } catch (err) {
    throw err instanceof ValioError ? err : new ValioError(`${endpoint} call failed: ${(err as Error).message}`);
  }
}

/**
 * Availability and price rows for `ids` for delivery on `date`: from the recorded replies when replay is on
 * (0 network calls), else live from the Valio mock in batches of 1,000 ids. `fetchFn` is injectable for tests.
 */
export async function fetchOffers(env: Env, ids: string[], date: string, fetchFn: typeof fetch = fetch): Promise<Offers> {
  const unique = [...new Set(ids)];
  const calls = Math.ceil(unique.length / BATCH) * 2;
  if (await replayOn(env)) {
    return { ...(await replayOffers(env, unique)), calls, liveCalls: 0, replay: true, ids: unique };
  }
  const availability = new Map<string, AvailabilityRow>();
  const price = new Map<string, PriceRow>();
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const [a, p] = await Promise.all([post(env, 'availability', batch, date, fetchFn), post(env, 'price', batch, date, fetchFn)]);
    for (const x of a.products as AvailabilityRow[]) availability.set(x.productId, x);
    for (const x of p.products as PriceRow[]) price.set(x.productId, x);
  }
  return { availability, price, calls, liveCalls: calls, replay: false, ids: unique };
}
