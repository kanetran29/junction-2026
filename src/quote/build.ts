import { normBrand, type CatalogProduct } from '../catalog/search';
import { defaultSubtype } from '../catalog/subtypes';
import { helsinkiIso } from '../clock';
import { defaultMandate } from '../domain/constants';
import { grossCents, halfUp, lineNetCents } from '../domain/money';
import type { ReasonCode } from '../domain/reasons';
import { contentPerSalesUnit, fillQuantity, type Quantity } from '../offers/conversion';
import { orderable } from '../offers/orderable';
import { checkSubstitute } from '../policy/substitute';
import type { Offers } from '../valio/client';

/**
 * A confirmed typed need. Exactly one form is set: a category need (`category`), a reference need (`referenceProduct`)
 * or a product list (`products`); the HTTP layer validates that, the builder only reads the fields.
 */
export interface Draft {
  category?: string;
  subtype?: string;
  claims?: string[];
  quantity: Quantity;
  deliverBy: string;
  brand?: { rule: 'only' | 'prefer'; names: string[] };
  packLitres?: number;
  referenceProduct?: string;
  allowSubstitutes?: boolean;
  products?: string[];
}

export interface OfferLine {
  productId: string;
  salesUnits: number;
  salesUnit: string | null;
  contentPerSalesUnit: number;
  contentUnit: Quantity['unit'];
  netCentsPerSalesUnit: number;
  taxRate: number;
  deliveryDate: string;
}

export interface Offer {
  offerId: string;
  /** The product when the offer has one line, else null (a split offer). */
  productId: string | null;
  lines: OfferLine[];
  /** Litres or kilos delivered, in the unit of the lines' content. */
  filled: number;
  overage: number;
  shortfall: number;
  netCents: number;
  grossCents: number;
  centsPerContentUnit: number;
  closingTime: string;
  deliveryDate: string;
  reliability: { value: number | null; tri: 'pass' | 'fail' | 'unknown' };
  labels: string[];
  carbonKg: number | null;
  carbonLabel: 'product-group average';
  estimate: boolean;
  changes: ReasonCode[];
}

export interface Rejection {
  productId: string;
  code: ReasonCode;
  detail: string;
  labels: string[];
}

export interface Quote {
  id: string;
  buyerId: string;
  draftId: string;
  createdAt: string;
  expiresAt: string;
  offers: Offer[];
  rejections: Rejection[];
  notes: { code: ReasonCode; detail: string }[];
  valioCalls: number;
  liveValioCalls: number;
  replay: boolean;
  rankedBy: [...typeof RANKED_BY];
  summary: { candidates: number; offered: number; rejected: number; unaccounted: number };
  understoodAs: Draft;
  coverage: { reliability: string };
}

export interface BuildInput {
  id: string;
  buyerId: string;
  draftId: string;
  draft: Draft;
  /** The catalogue products to consider; for a reference need the reference and its official substitutes. */
  products: CatalogProduct[];
  offers: Offers;
  now: Date;
  /** Sales units already taken by ACCEPTED orders for the same delivery day, by product id. */
  acceptedUnits?: Map<string, number>;
  /** Brand names of the draft that no product in the whole catalogue carries. */
  brandsNotCarried?: string[];
}

/** The order offer `changes` are listed in. */
const CHANGE_ORDER: ReasonCode[] = ['SUBSTITUTE', 'ALLERGEN_UNKNOWN', 'SUBTYPE_UNVERIFIED', 'PACK_SIZE_CHANGED', 'BRAND_CHANGED', 'SHORTFALL'];
const RELIABILITY_FLOOR = defaultMandate('').reliabilityFloor;
/** The tie-break chain offers are ranked by after covering offers and a preferred brand; published in every quote and in `/v1/rules`. */
export const RANKED_BY = ['netTotal', 'unitPrice', 'reliability'] as const;

/** How long a quote stays valid at most, before the earlier cut-off and price-validity limits apply. */
export const QUOTE_TTL_MS = 30 * 60_000;

/** Rounds to `dp` decimals (tames float noise such as 4.4 x 5). */
const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;

/** Everything one candidate evaluation reads: the draft, Valio's rows, the clock and the quantity in content units. */
interface Ctx {
  draft: Draft;
  offers: Offers;
  now: Date;
  accepted: Map<string, number>;
  qty: Quantity;
  wantedSubtype: string | null;
  brandNorms: string[];
  reference?: CatalogProduct;
}

/** A product that passed every check but stock: priced, converted and ready to go into an offer. */
interface Feasible {
  product: CatalogProduct;
  closingTime: string;
  deliveryDate: string;
  validTo: string | undefined;
  priceEuros: number;
  taxRate: number;
  content: { value: number; unit: Quantity['unit'] };
  salesUnits: number;
  /** Sales units still free: Valio's limit less accepted lines, Infinity when unlimited. */
  available: number;
  centsPerContentUnit: number;
  flags: ReasonCode[];
}

type Evaluation = { rejection: Rejection } | { feasible: Feasible };

/**
 * Runs one candidate through the published checks and returns its first failing code as a rejection, or the priced
 * and converted product. The order is `REJECTION_PRECEDENCE`: orderable, substitute safety, brand, subtype,
 * conversion, then stock. `substituteOf` is set for a substitute of the reference product.
 */
function evaluate(p: CatalogProduct, x: Ctx, substituteOf?: CatalogProduct): Evaluation {
  const reject = (code: ReasonCode, detail: string): Evaluation => ({ rejection: { productId: p.id, code, detail, labels: p.labels } });
  const av = x.offers.availability.get(p.id);
  const price = x.offers.price.get(p.id);
  if (!av) return reject('PRICE_UNAVAILABLE', 'Valio returned no row for this product');
  const ord = orderable(av, price, x.now, x.draft.deliverBy, p);
  if (!ord.ok) return reject(ord.code, ord.detail);
  const flags: ReasonCode[] = [];
  if (substituteOf) {
    const check = checkSubstitute(substituteOf, p);
    if (!check.ok) return reject(check.code, check.detail);
    flags.push('SUBSTITUTE');
    if (check.allergensUnknown) flags.push('ALLERGEN_UNKNOWN');
  }
  const brand = x.draft.brand;
  if (brand && !x.brandNorms.includes(p.brandNorm)) {
    if (brand.rule === 'only') return reject('BRAND_EXCLUDED', `brand ${p.brand ?? 'unknown'} is not ${brand.names.join(', ')}`);
    flags.push('BRAND_CHANGED');
  }
  if (x.wantedSubtype) {
    if (p.tagSource === 'model') flags.push('SUBTYPE_UNVERIFIED');
    else if (p.subtype !== x.wantedSubtype) return reject('SUBTYPE_MISMATCH', `${p.subtype ?? 'untyped'}, not ${x.wantedSubtype}`);
  }
  const priceRow = price!;
  let content: { value: number; unit: Quantity['unit'] } | null = contentPerSalesUnit(p, priceRow);
  // a pcs need on the reference itself is its own sales units, even when Valio gives no litre or kilo content
  if (!content && x.qty.unit === 'pcs' && x.reference?.id === p.id) content = { value: 1, unit: 'pcs' };
  if (!content) return reject('NOT_CONVERTIBLE', 'no litre or kilo content known for this product');
  const fill = fillQuantity(x.qty, content, p.lotStep);
  if ('code' in fill) return reject('NOT_CONVERTIBLE', `${x.qty.unit} requested, this product is sold by ${content.unit}`);
  const available = ord.limit === null ? Infinity : Math.max(0, round(ord.limit - (x.accepted.get(p.id) ?? 0), 3));
  if (available <= 0) return reject('STOCK_LIMITED', '0 available');
  const priceEuros = priceRow.catalogPrice!.value!;
  return {
    feasible: {
      product: p,
      closingTime: ord.closingTime,
      deliveryDate: ord.deliveryDate,
      validTo: priceRow.catalogPrice!.validTo,
      priceEuros,
      taxRate: priceRow.tax?.taxRate ?? 0,
      content,
      salesUnits: fill.salesUnits,
      available,
      centsPerContentUnit: halfUp(priceEuros * 100) / content.value,
      flags,
    },
  };
}

/**
 * When no single product covers the quantity: takes the reference product's own stock first (the buyer asked for it),
 * then the cheapest (per litre or kilo) limited products in turn, whole lots only, until the quantity is covered or the stock runs out.
 */
function splitLines(feasible: Feasible[], qty: Quantity, referenceId?: string): { f: Feasible; salesUnits: number }[] {
  const first = (f: Feasible) => (f.product.id === referenceId ? 0 : 1);
  const order = feasible
    .filter((f) => f.available > 0)
    .sort((a, b) => first(a) - first(b) || a.centsPerContentUnit - b.centsPerContentUnit || (a.product.id < b.product.id ? -1 : 1));
  const lines: { f: Feasible; salesUnits: number }[] = [];
  let remaining = qty.value;
  for (const f of order) {
    if (remaining <= 0) break;
    const lot = f.product.lotStep ?? 1;
    const maxUnits = round(Math.floor(round(f.available / lot, 6)) * lot, 6);
    if (maxUnits <= 0) continue;
    const want = fillQuantity({ value: remaining, unit: qty.unit }, f.content, f.product.lotStep) as { salesUnits: number };
    const salesUnits = Math.min(want.salesUnits, maxUnits);
    lines.push({ f, salesUnits });
    remaining = round(remaining - salesUnits * f.content.value, 6);
  }
  return lines;
}

/** Builds one unranked offer (no `offerId` yet) from lines of feasible products and their sales units. */
function makeOffer(lines: { f: Feasible; salesUnits: number }[], x: Ctx): Omit<Offer, 'offerId'> {
  const netCents = lines.reduce((s, { f, salesUnits }) => s + lineNetCents(f.priceEuros, salesUnits), 0);
  const byRate = new Map<number, number>();
  for (const { f, salesUnits } of lines) byRate.set(f.taxRate, (byRate.get(f.taxRate) ?? 0) + lineNetCents(f.priceEuros, salesUnits));
  const filled = round(lines.reduce((s, { f, salesUnits }) => s + salesUnits * f.content.value, 0), 3);
  const shortfall = Math.max(0, round(x.qty.value - filled, 3));
  const flags = new Set<ReasonCode>(lines.flatMap(({ f }) => f.flags));
  const pack = x.draft.packLitres;
  if (pack !== undefined && lines.some(({ f }) => f.content.unit !== 'l' || f.content.value !== pack)) flags.add('PACK_SIZE_CHANGED');
  if (shortfall > 0) flags.add('SHORTFALL');
  const reliabilities = lines.map(({ f }) => f.product.reliability);
  const reliability = reliabilities.some((r) => r === null) ? null : Math.min(...(reliabilities as number[]));
  const carbons = lines.map(({ f, salesUnits }) => (f.product.carbon === null ? null : f.product.carbon * salesUnits * f.content.value));
  return {
    productId: lines.length === 1 ? lines[0].f.product.id : null,
    lines: lines.map(({ f, salesUnits }) => ({
      productId: f.product.id,
      salesUnits,
      salesUnit: f.product.salesUnit,
      contentPerSalesUnit: f.content.value,
      contentUnit: f.content.unit,
      netCentsPerSalesUnit: halfUp(f.priceEuros * 100),
      taxRate: f.taxRate,
      deliveryDate: f.deliveryDate,
    })),
    filled,
    overage: Math.max(0, round(filled - x.qty.value, 3)),
    shortfall,
    netCents,
    grossCents: grossCents(byRate),
    centsPerContentUnit: filled > 0 ? round(netCents / filled, 4) : 0,
    closingTime: lines.map(({ f }) => f.closingTime).sort((a, b) => Date.parse(a) - Date.parse(b))[0],
    deliveryDate: lines.map(({ f }) => f.deliveryDate).sort().at(-1)!,
    reliability: { value: reliability, tri: reliability === null ? 'unknown' : reliability < RELIABILITY_FLOOR ? 'fail' : 'pass' },
    labels: [...new Set(lines.flatMap(({ f }) => f.product.labels))].sort(),
    carbonKg: carbons.every((c): c is number => c !== null) ? round(carbons.reduce((s, c) => s + c, 0), 3) : null,
    carbonLabel: 'product-group average',
    estimate: lines.some(({ f }) => f.product.variableWeight),
    changes: CHANGE_ORDER.filter((c) => flags.has(c)),
  };
}

/**
 * Evaluates the candidates and turns them into unranked offers and typed rejections. Single-product offers for every
 * product whose free stock covers the need; when none does, one split offer over the limited products. A limited
 * product that ends up in no offer is rejected STOCK_LIMITED with its available amount.
 */
function assemble(candidates: CatalogProduct[], x: Ctx): { offers: Omit<Offer, 'offerId'>[]; rejections: Rejection[] } {
  const rejections: Rejection[] = [];
  const feasible: Feasible[] = [];
  for (const p of candidates) {
    const e = evaluate(p, x, x.reference && p.id !== x.reference.id ? x.reference : undefined);
    if ('rejection' in e) rejections.push(e.rejection);
    else feasible.push(e.feasible);
  }
  const singles = feasible.filter((f) => f.available >= f.salesUnits);
  const lines = singles.length ? singles.map((f) => [{ f, salesUnits: f.salesUnits }]) : [splitLines(feasible, x.qty, x.reference?.id)].filter((l) => l.length);
  const used = new Set(lines.flat().map(({ f }) => f.product.id));
  for (const f of feasible) {
    if (!used.has(f.product.id)) {
      rejections.push({ productId: f.product.id, code: 'STOCK_LIMITED', detail: `${f.available} available, ${f.salesUnits} needed`, labels: f.product.labels });
    }
  }
  const order = new Map(candidates.map((p, i) => [p.id, i]));
  rejections.sort((a, b) => order.get(a.productId)! - order.get(b.productId)!);
  return { offers: lines.map((l) => makeOffer(l, x)), rejections };
}

/**
 * Builds the quote for a confirmed draft from the catalogue candidates and Valio's replies (pure, no I/O).
 * Offers are ranked by net total, then cents per litre or kilo, then reliability, those that cover the quantity first;
 * every candidate ends in exactly one offer or one rejection, and `summary.unaccounted` proves it.
 */
export function buildQuote(input: BuildInput): Quote {
  const { draft, offers, now } = input;
  const byId = new Map(input.products.map((p) => [p.id, p]));
  const listed = draft.products ? [...new Set(draft.products)] : undefined;
  const brand = draft.brand;
  const reference = draft.referenceProduct ? byId.get(draft.referenceProduct) : undefined;

  let qty: Quantity = draft.quantity;
  if (qty.unit === 'pcs' && reference) {
    const price = offers.price.get(reference.id);
    const content = price ? contentPerSalesUnit(reference, price) : null;
    if (content) qty = { value: round(qty.value * content.value, 6), unit: content.unit };
  }
  const x: Ctx = {
    draft,
    offers,
    now,
    accepted: input.acceptedUnits ?? new Map(),
    qty,
    wantedSubtype: draft.category ? (draft.subtype ?? defaultSubtype(draft.category)) : null,
    brandNorms: (brand?.names ?? []).map(normBrand),
    reference,
  };

  let candidates: CatalogProduct[];
  let unknown: string[] = [];
  if (listed) {
    candidates = listed!.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
    unknown = listed!.filter((id) => !byId.has(id));
  } else if (draft.referenceProduct) {
    candidates = reference ? [reference] : [];
    unknown = reference ? [] : [draft.referenceProduct];
  } else {
    candidates = input.products;
  }

  let result = assemble(candidates, x);
  if (reference && draft.allowSubstitutes && !result.offers.some((o) => o.shortfall === 0)) {
    const subs = [...new Set(reference.substitutes)].filter((id) => id !== reference.id && byId.has(id)).map((id) => byId.get(id)!);
    if (subs.length) {
      candidates = [reference, ...subs];
      result = assemble(candidates, x);
    }
  }

  const rejections = [
    ...result.rejections,
    ...unknown.map((productId): Rejection => ({ productId, code: 'PRICE_UNAVAILABLE', detail: 'unknown product id', labels: [] })),
  ];
  const ranked = result.offers
    .map((o) => ({ o, preferred: brand?.rule === 'prefer' && !o.changes.includes('BRAND_CHANGED') ? 0 : 1 }))
    .sort(
      (a, b) =>
        Number(a.o.shortfall > 0) - Number(b.o.shortfall > 0) ||
        a.preferred - b.preferred ||
        a.o.netCents - b.o.netCents ||
        a.o.centsPerContentUnit - b.o.centsPerContentUnit ||
        (b.o.reliability.value ?? -1) - (a.o.reliability.value ?? -1) ||
        (a.o.lines[0].productId < b.o.lines[0].productId ? -1 : 1),
    )
    .map(({ o }, i): Offer => ({ offerId: `o${i + 1}`, ...o }));

  const candidateCount = candidates.length + unknown.length;
  const used = new Set(ranked.flatMap((o) => o.lines.map((l) => l.productId)));
  const offered = used.size;
  const expiry = [
    now.getTime() + QUOTE_TTL_MS,
    ...ranked.map((o) => Date.parse(o.closingTime)),
    ...[...used].flatMap((id) => {
      const validTo = offers.price.get(id)?.catalogPrice?.validTo;
      return validTo ? [Date.parse(validTo)] : [];
    }),
  ];
  const known = candidates.filter((p) => p.reliability !== null).length;
  return {
    id: input.id,
    buyerId: input.buyerId,
    draftId: input.draftId,
    createdAt: helsinkiIso(now),
    expiresAt: helsinkiIso(new Date(Math.min(...expiry))),
    offers: ranked,
    rejections,
    notes: (input.brandsNotCarried ?? []).map((name) => ({ code: 'BRAND_NOT_CARRIED' as const, detail: `Valio does not carry the brand ${name}` })),
    valioCalls: offers.calls,
    liveValioCalls: offers.liveCalls,
    replay: offers.replay,
    rankedBy: [...RANKED_BY],
    summary: { candidates: candidateCount, offered, rejected: rejections.length, unaccounted: candidateCount - offered - rejections.length },
    understoodAs: draft,
    coverage: { reliability: `${known} of ${candidateCount}` },
  };
}
