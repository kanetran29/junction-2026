import { z } from 'zod';
import { getProducts, normBrand, searchProducts, type CatalogProduct } from '../catalog/search';
import { helsinkiIso, now } from '../clock';
import type { Env } from '../env';
import { logEvent } from '../events/log';
import { orderable } from '../offers/orderable';
import type { ReasonCode } from '../domain/reasons';
import { ValioError, fetchOffers, type Offers } from '../valio/client';
import { newId } from '../util';
import { buildQuote, type Draft, type Quote } from './build';
import { db } from '../db';

/** A quote request that cannot be answered: Valio failed (UPSTREAM_ERROR) or the named draft is missing or not confirmed. */
export class QuoteError extends Error {
  constructor(
    public code: ReasonCode | 'DRAFT_NOT_FOUND' | 'DRAFT_NOT_CONFIRMED',
    message: string,
  ) {
    super(message);
    this.name = 'QuoteError';
  }
}

const quantity = z.object({ value: z.number().positive(), unit: z.enum(['l', 'kg', 'pcs']) });

/** The typed need: a category need, a reference need or a product list, exactly one of the three. */
export const draftSchema = z
  .object({
    category: z.string().min(1).optional(),
    subtype: z.string().min(1).optional(),
    claims: z.array(z.string().min(1)).optional(),
    quantity,
    deliverBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    brand: z.object({ rule: z.enum(['only', 'prefer']), names: z.array(z.string().min(1)).min(1) }).optional(),
    packLitres: z.number().positive().optional(),
    referenceProduct: z.string().min(1).optional(),
    allowSubstitutes: z.boolean().optional(),
    products: z.array(z.string().min(1)).min(1).max(1000).optional(),
  })
  .refine((d) => [d.category, d.referenceProduct, d.products].filter((x) => x !== undefined).length === 1, {
    message: 'give exactly one of category, referenceProduct or products',
  });

/** What a quote request names: a stored draft, a draft to confirm and use, or a product list. */
export type QuoteInput = { draftId: string } | { draft: unknown } | { products: string[]; quantity: unknown; deliverBy: string };

/** Stores a quote (one row per quote, body is the JSON). */
export async function saveQuote(env: Env, q: Quote): Promise<void> {
  await db(env).prepare('INSERT INTO quotes(id, buyer_id, body, created_at, expires_at) VALUES (?,?,?,?,?)')
    .bind(q.id, q.buyerId, JSON.stringify(q), q.createdAt, q.expiresAt)
    .run();
}

/** The buyer's own quote by id, or null when it does not exist or belongs to another buyer. */
export async function getQuote(env: Env, buyerId: string, id: string): Promise<Quote | null> {
  const row = await db(env).prepare('SELECT body FROM quotes WHERE id = ? AND buyer_id = ?').bind(id, buyerId).first<{ body: string }>();
  return row ? (JSON.parse(row.body) as Quote) : null;
}

/** Loads a buyer's stored draft that is confirmed; anything else is a QuoteError. */
async function loadDraft(env: Env, buyerId: string, draftId: string): Promise<Draft> {
  const row = await db(env).prepare('SELECT body FROM drafts WHERE id = ? AND buyer_id = ?').bind(draftId, buyerId).first<{ body: string }>();
  if (!row) throw new QuoteError('DRAFT_NOT_FOUND', `no draft ${draftId}`);
  const body = JSON.parse(row.body) as { status?: string };
  if (body.status !== 'confirmed') throw new QuoteError('DRAFT_NOT_CONFIRMED', `draft ${draftId} is ${body.status ?? 'not confirmed'}`);
  return draftSchema.parse(body) as Draft;
}

/** The catalogue candidates for a need: the category search, the reference with its official substitutes, or the listed products. */
async function findCandidates(env: Env, d: Draft): Promise<CatalogProduct[]> {
  if (d.category) return searchProducts(env, { category: d.category, claims: d.claims ?? [] });
  if (d.referenceProduct) {
    const [ref] = await getProducts(env, [d.referenceProduct]);
    if (!ref) return [];
    return [ref, ...(d.allowSubstitutes ? await getProducts(env, ref.substitutes) : [])];
  }
  return getProducts(env, d.products!);
}

/**
 * Sales units per product already taken by ACCEPTED order lines for the delivery day the product would arrive on
 * (HELD orders and quotes reserve nothing); only products Valio currently lets us order are considered.
 */
async function acceptedUnits(env: Env, products: CatalogProduct[], offers: Offers, at: Date, deliverBy: string): Promise<Map<string, number>> {
  const { results } = await db(env).prepare(
    "SELECT product_id, delivery_date, SUM(sales_units) AS units FROM order_lines WHERE state = 'ACCEPTED' AND product_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) GROUP BY product_id, delivery_date",
  )
    .bind(JSON.stringify(products.map((p) => p.id)))
    .all<{ product_id: string; delivery_date: string; units: number }>();
  const taken = new Map<string, number>();
  for (const r of results) {
    const p = products.find((x) => x.id === r.product_id);
    const av = offers.availability.get(r.product_id);
    if (!p || !av) continue;
    const ord = orderable(av, offers.price.get(r.product_id), at, deliverBy, p);
    if (ord.ok && ord.deliveryDate === r.delivery_date) taken.set(r.product_id, r.units);
  }
  return taken;
}

/** The brand names of the draft that no product in the whole catalogue carries (compared normalised). */
async function brandsNotCarried(env: Env, d: Draft): Promise<string[]> {
  const missing: string[] = [];
  for (const name of d.brand?.names ?? []) {
    const hit = await env.DB.prepare('SELECT 1 AS x FROM products WHERE brand_norm = ? LIMIT 1').bind(normBrand(name)).first();
    if (!hit) missing.push(name);
  }
  return missing;
}

/**
 * Quotes a need for a buyer: validates it (zod) and stores a posted draft as confirmed, searches the catalogue, asks
 * Valio once per endpoint about that shortlist only, takes accepted order lines off limited stock, builds and saves the
 * quote and appends `search.done`, two `valio.called` and `quote.created` events. A failing Valio call is UPSTREAM_ERROR.
 */
export async function createQuote(env: Env, buyerId: string, input: QuoteInput, fetchFn: typeof fetch = fetch): Promise<Quote> {
  const at = await now(env);
  let draftId: string;
  let draft: Draft;
  if ('draftId' in input) {
    draftId = input.draftId;
    draft = await loadDraft(env, buyerId, draftId);
  } else {
    draft = draftSchema.parse('draft' in input ? input.draft : input) as Draft;
    draftId = newId('d');
    await db(env).prepare('INSERT INTO drafts(id, buyer_id, body, created_at) VALUES (?,?,?,?)')
      .bind(draftId, buyerId, JSON.stringify({ ...draft, status: 'confirmed' }), helsinkiIso(at))
      .run();
  }
  const quoteId = newId('q');
  const ref = { buyerId, draftId, quoteId };

  const products = await findCandidates(env, draft);
  await logEvent(env, { ...ref, type: 'search.done', data: { count: products.length, categories: [...new Set(products.map((p) => p.category))] } });

  const ids = draft.products ?? [...new Set([...(draft.referenceProduct ? [draft.referenceProduct] : []), ...products.map((p) => p.id)])];
  let offers: Offers;
  try {
    offers = await fetchOffers(env, ids, draft.deliverBy, fetchFn);
  } catch (err) {
    if (err instanceof ValioError) throw new QuoteError('UPSTREAM_ERROR', err.message);
    throw err;
  }
  for (const endpoint of ['availability', 'price']) {
    await logEvent(env, { ...ref, type: 'valio.called', data: { endpoint, ids: offers.ids, replay: offers.replay } });
  }

  const q = buildQuote({
    id: quoteId,
    buyerId,
    draftId,
    draft,
    products,
    offers,
    now: at,
    acceptedUnits: await acceptedUnits(env, products, offers, at, draft.deliverBy),
    brandsNotCarried: await brandsNotCarried(env, draft),
  });
  await saveQuote(env, q);
  await logEvent(env, {
    ...ref,
    type: 'quote.created',
    data: {
      offers: q.offers.map((o) => ({ offerId: o.offerId, lines: o.lines.map((l) => ({ productId: l.productId, salesUnits: l.salesUnits })), netCents: o.netCents, changes: o.changes })),
      rejections: q.rejections.map((r) => ({ productId: r.productId, code: r.code })),
    },
  });
  return q;
}
