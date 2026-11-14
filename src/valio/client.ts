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

/**
 * Valio answered 429: it blocks the caller for a while (30 s unless it says `Retry-After`). Carries the wait in whole
 * seconds; callers map it to HTTP 503 VALIO_RATE_LIMITED. Not a ValioError, so no caller turns it into UPSTREAM_ERROR.
 */
export class ValioRateLimited extends Error {
  constructor(readonly retryAfter: number) {
    super(`Valio asked us to slow down; retry after ${retryAfter} s`);
    this.name = 'ValioRateLimited';
  }
}

// ponytail: per isolate, each isolate learns the block from its own first 429; upgrade path = a shared store (D1/KV/DO) if Valio blocks per account.
let blockedUntil = 0;

/** Forgets the rate-limit block (tests). */
export function clearValioBlock(): void {
  blockedUntil = 0;
}

/** Throws ValioRateLimited with the whole seconds left (at least 1) while a block from an earlier 429 lasts, by the real wall clock. */
function assertNotBlocked(): void {
  const left = blockedUntil - Date.now();
  if (left > 0) throw new ValioRateLimited(Math.max(1, Math.ceil(left / 1000)));
}

/** Seconds to wait from a `Retry-After` header (delta seconds or an HTTP date); 30 when it is absent or unreadable. */
function retryAfterSeconds(header: string | null): number {
  const n = Number(header);
  const secs = header && Number.isFinite(n) ? n : header ? (Date.parse(header) - Date.now()) / 1000 : 30;
  return Number.isFinite(secs) ? Math.max(1, Math.ceil(secs)) : 30;
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
 * a network error, a non-200, a body that is not JSON, or a reply without a `products` array. A 429 is a ValioRateLimited.
 */
async function post(env: Env, endpoint: 'availability' | 'price', ids: string[], date: string, fetchFn: typeof fetch): Promise<{ timeNow: string; products: unknown[] }> {
  try {
    const res = await fetchFn(`${env.VALIO_API_BASE}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'X-API-Key': env.VALIO_API_KEY, 'User-Agent': 'lazydoor/0.1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer: 'lazydoor', requestedDate: date, products: ids }),
    });
    if (res.status === 429) {
      const secs = retryAfterSeconds(res.headers.get('Retry-After'));
      blockedUntil = Date.now() + secs * 1000;
      throw new ValioRateLimited(secs);
    }
    if (!res.ok) throw new ValioError(`${endpoint} returned ${res.status}`);
    const body = (await res.json()) as { timeNow: string; products: unknown[] } | null;
    if (!body || !Array.isArray(body.products)) throw new ValioError(`${endpoint} reply has no products`);
    return withIsoOffsets(body);
  } catch (err) {
    throw err instanceof ValioError || err instanceof ValioRateLimited ? err : new ValioError(`${endpoint} call failed: ${(err as Error).message}`);
  }
}

/**
 * Availability and price rows for `ids` for delivery on `date`: from the recorded replies when replay is on
 * (0 network calls), else live from the Valio mock in batches of 1,000 ids; a 429, or a block still running from one, throws ValioRateLimited without a call. `fetchFn` is injectable for tests.
 */
export async function fetchOffers(env: Env, ids: string[], date: string, fetchFn: typeof fetch = fetch): Promise<Offers> {
  const unique = [...new Set(ids)];
  const calls = Math.ceil(unique.length / BATCH) * 2;
  if (await replayOn(env)) {
    return { ...(await replayOffers(env, unique)), calls, liveCalls: 0, replay: true, ids: unique };
  }
  assertNotBlocked();
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
