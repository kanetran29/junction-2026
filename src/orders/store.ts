import { getProducts, type CatalogProduct } from '../catalog/search';
import { helsinkiIso, now } from '../clock';
import { MANDATE_AUD, type Mandate } from '../domain/constants';
import { grossCents, halfUp, lineNet } from '../domain/money';
import type { ReasonCode } from '../domain/reasons';
import type { Env } from '../env';
import { logEvent, type NewEvent } from '../events/log';
import { MandateError, loadMandate } from '../mandate/jws';
import { orderable } from '../offers/orderable';
import { decide, type Decision, type Reason, type Unmet } from '../policy/decide';
import type { Offer, OfferLine, Quote } from '../quote/build';
import { createQuote, getQuote, offerClaims } from '../quote/store';
import { AUD, doorKey, signJws, verifyJws } from '../sign/door';
import { canonicalJson, newId, sha256Hex } from '../util';
import { ValioError, fetchOffers, type Offers } from '../valio/client';
import { db } from '../db';

export type OrderState = 'PLACING' | 'ACCEPTED' | 'HELD' | 'REJECTED' | 'EXPIRED';

/** What an order holds besides its money: the lines the buyer gets and the needs no offer covered. */
export interface Order {
  id: string;
  state: OrderState;
  lines: OfferLine[];
  unmet: Unmet[];
  netCents: number;
  grossCents: number;
  deliveryDate: string | null;
}

/**
 * The order as every reply shows it: state, why, the decision, who must approve and the order itself, and once the order is
 * final (ACCEPTED, REJECTED or EXPIRED) the door's JWS over its receipt claims. Never a token or URL.
 */
export interface OrderView {
  orderId: string;
  state: OrderState;
  reason?: string;
  decision: Decision;
  approval: { status: 'pending' | 'none'; approver: string };
  order: Order;
  jws?: string;
}

export type PlaceReply = OrderView & { available?: number; retryable?: boolean; resolution?: 'requote' };

/** One chosen offer; `quoteJws`, when sent, must be that offer's JWS as the door signed it. */
type Selection = { quoteId: string; offerId: string; quoteJws?: string };

export type PlaceRequest = { buyerId: string; idempotencyKey?: string; agentReason?: string } & (Selection | { basketId: string; selections: Selection[] });

export interface ApproveReply {
  orderId: string;
  state: 'ACCEPTED' | 'EXPIRED' | 'REJECTED';
  reason?: string;
  available?: number;
}

/** A refusal the HTTP layer maps straight onto a status and a machine-readable code. */
export class OrderError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 502,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OrderError';
  }
}

/** A stored order row (only the columns this module reads). */
interface Row {
  id: string;
  buyer_id: string;
  quote_id: string | null;
  basket_id: string | null;
  request_hash: string | null;
  state: OrderState;
  reason: string | null;
  net_cents: number;
  gross_cents: number;
  delivery_date: string | null;
  body: string;
  decision: string | null;
  approver: string | null;
  approval_token: string | null;
  expires_at: string | null;
  mandate_version: number | null;
  lines_hash: string | null;
  reply: string | null;
  decided_at: string | null;
}

/** One product on one delivery day: how many sales units the order needs and Valio's limit read at commit (null = Valio's stock is unknown). */
interface Check {
  productId: string;
  deliveryDate: string;
  needed: number;
  limit: number | null;
}

type Ref = Pick<NewEvent, 'buyerId' | 'orderId' | 'quoteId'>;

const EPS = 1e-9;
const PLACING_TTL_MS = 60_000;
/** Rounds to 3 decimals (stock amounts shown to buyers). */
const round3 = (x: number) => Math.round(x * 1000) / 1000;
/** A random 32-byte approval token as unpadded base64url. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The binding of an approval token: sha256 over the canonical JSON of every line (product, sales units, unit, net cents per
 * unit, tax rate, delivery date), the buyer and the mandate version, so a token cannot approve anything else.
 */
function linesHash(lines: OfferLine[], buyerId: string, mandateVersion: number): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      lines: lines.map((l) => ({ productId: l.productId, salesUnits: l.salesUnits, unit: l.salesUnit, netCentsPerSalesUnit: l.netCentsPerSalesUnit, taxRate: l.taxRate, deliveryDate: l.deliveryDate })),
      buyerId,
      mandateVersion,
    }),
  );
}

/** Basket-level gross: the net of every line grouped per VAT rate, grossed up per rate. */
function basketGross(lines: OfferLine[]): number {
  const byRate = new Map<number, number>();
  for (const l of lines) byRate.set(l.taxRate, (byRate.get(l.taxRate) ?? 0) + lineNet(l));
  return grossCents(byRate);
}

/** The states after which an order never changes again; only these carry a signed receipt. */
const FINAL: OrderState[] = ['ACCEPTED', 'REJECTED', 'EXPIRED'];

/**
 * What a final order's JWS binds: the order, buyer and state, every line (product, sales units, unit price, line net,
 * delivery date), the totals and currency, who approved it (the mandate's approver when a human approval accepted it: only
 * an order that was HELD keeps its approval token, the commit clears it on every other; else null), when it was decided
 * (door time) and the receipt audience.
 */
function receiptClaims(r: Row, v: OrderView) {
  return {
    orderId: r.id,
    buyerId: r.buyer_id,
    state: r.state,
    lines: v.order.lines.map((l) => ({ productId: l.productId, salesUnits: l.salesUnits, unitPriceCents: l.netCentsPerSalesUnit, netCents: lineNet(l), deliveryDate: l.deliveryDate })),
    netCents: r.net_cents,
    grossCents: r.gross_cents,
    currency: 'EUR',
    approvedBy: r.state === 'ACCEPTED' && r.approval_token !== null ? r.approver : null,
    decidedAt: r.decided_at,
    aud: AUD.receipt,
  };
}

/** The reply view of a row plus, once the order is final and its decision time is recorded, the door's receipt JWS. */
async function signedView(env: Env, r: Row): Promise<OrderView> {
  const v = view(r);
  return FINAL.includes(r.state) && r.decided_at ? { ...v, jws: await signJws(env, receiptClaims(r, v)) } : v;
}

/** Shapes a stored row as the reply every endpoint shows (the row's `decision` column is the decision shown). */
function view(r: Row): OrderView {
  const body = JSON.parse(r.body) as { lines: OfferLine[]; unmet: Unmet[] };
  return {
    orderId: r.id,
    state: r.state,
    ...(r.reason ? { reason: r.reason } : {}),
    decision: JSON.parse(r.decision ?? '{"outcome":"REJECT","reasons":[]}') as Decision,
    approval: { status: r.state === 'HELD' ? 'pending' : 'none', approver: r.approver ?? '' },
    order: { id: r.id, state: r.state, lines: body.lines, unmet: body.unmet, netCents: r.net_cents, grossCents: r.gross_cents, deliveryDate: r.delivery_date },
  };
}

/** Reads one order row by id. */
async function rowById(env: Env, id: string): Promise<Row | null> {
  return db(env).prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<Row>();
}

/** The buyer's own order as a reply view, or null when it does not exist, is another buyer's or is still being placed. */
export async function getOrder(env: Env, buyerId: string, id: string): Promise<OrderView | null> {
  const r = await db(env).prepare("SELECT * FROM orders WHERE id = ? AND buyer_id = ? AND state <> 'PLACING'").bind(id, buyerId).first<Row>();
  return r ? signedView(env, r) : null;
}

/** SQL: true when no checked product has less free stock than the order needs; `n` numbers the parameter holding the checks JSON. */
const noShortLine = (n: number) =>
  `NOT EXISTS (SELECT 1 FROM jsonb_array_elements(?${n}::text::jsonb) c WHERE c->>'limit' IS NOT NULL AND (c->>'limit')::float8 - COALESCE((SELECT SUM(l.sales_units) FROM order_lines l WHERE l.product_id = c->>'productId' AND l.delivery_date = c->>'deliveryDate' AND l.state = 'ACCEPTED'), 0) < (c->>'needed')::float8 - 1e-9)`;

/** Appends the order's lines to the ledger (state ACCEPTED) as the lines JSON in parameter 3 says. */
const INSERT_LINES = `INSERT INTO order_lines(order_id, buyer_id, product_id, delivery_date, sales_units, state)
  SELECT ?1::text, ?2::text, j->>'productId', j->>'deliveryDate', (j->>'salesUnits')::float8, 'ACCEPTED' FROM jsonb_array_elements(?3::text::jsonb) j`;

/** The key of a Valio limit: one per product and delivery day. */
export const limitKey = (l: Pick<OfferLine, 'productId' | 'deliveryDate'>) => `${l.productId}|${l.deliveryDate}`;

/** Sums needed units per product and delivery day, with the limit Valio showed at commit. */
function toChecks(lines: OfferLine[], limits: Map<string, number | null>): Check[] {
  /** Valio's limit for a line's product and day; 0 when it was not read (not orderable). */
  const limitOf = (l: OfferLine) => (limits.has(limitKey(l)) ? limits.get(limitKey(l))! : 0);
  const m = new Map<string, Check>();
  for (const l of lines) {
    const k = limitKey(l);
    const c = m.get(k) ?? { productId: l.productId, deliveryDate: l.deliveryDate, needed: 0, limit: limitOf(l) };
    c.needed = Math.round((c.needed + l.salesUnits) * 1e6) / 1e6;
    m.set(k, c);
  }
  return [...m.values()];
}

/** Fetches Valio's availability and price for the lines' products (live or replay); a Valio failure is a 502 UPSTREAM_ERROR. */
async function fetchLineOffers(env: Env, lines: OfferLine[], fetchFn: typeof fetch): Promise<Offers> {
  try {
    return await fetchOffers(env, [...new Set(lines.map((l) => l.productId))], lines.map((l) => l.deliveryDate).sort()[0], fetchFn);
  } catch (err) {
    if (err instanceof ValioError) throw new OrderError(502, 'UPSTREAM_ERROR', err.message);
    throw err;
  }
}

/** Each line's limit per product and delivery day from Valio's rows (null = stock unknown; a product no longer orderable counts as 0) and the first reason a product is not orderable, if any. Writes nothing. */
async function limitsFrom(env: Env, lines: OfferLine[], at: Date, offers: Offers): Promise<{ limits: Map<string, number | null>; failure: ReasonCode | null }> {
  const products = new Map((await getProducts(env, [...new Set(lines.map((l) => l.productId))])).map((p) => [p.id, p]));
  const limits = new Map<string, number | null>();
  let failure: ReasonCode | null = null;
  for (const [k, l] of new Map(lines.map((l) => [limitKey(l), l]))) {
    const av = offers.availability.get(l.productId);
    const p = products.get(l.productId);
    const ord = av && p ? orderable(av, offers.price.get(l.productId), at, l.deliveryDate, p) : null;
    if (ord?.ok) limits.set(k, ord.limit);
    else {
      limits.set(k, 0);
      failure ??= ord ? ord.code : 'NOT_ORDERABLE';
    }
  }
  return { limits, failure };
}

/** Reads Valio's limits for the lines, logging the two `valio.called` events (the commit path; see `freeStock` for the write-free read). */
async function readLimits(env: Env, lines: OfferLine[], at: Date, ref: Ref, fetchFn: typeof fetch): Promise<{ limits: Map<string, number | null>; failure: ReasonCode | null; offers: Offers }> {
  const offers = await fetchLineOffers(env, lines, fetchFn);
  for (const endpoint of ['availability', 'price']) await logEvent(env, { ...ref, type: 'valio.called', data: { endpoint, ids: offers.ids, replay: offers.replay } });
  return { ...(await limitsFrom(env, lines, at, offers)), offers };
}

/** Sales units of ACCEPTED ledger lines for a product on a delivery day. */
async function acceptedUnits(env: Env, productId: string, deliveryDate: string): Promise<number> {
  const r = await db(env).prepare("SELECT COALESCE(SUM(sales_units), 0) AS u FROM order_lines WHERE product_id = ? AND delivery_date = ? AND state = 'ACCEPTED'").bind(productId, deliveryDate).first<{ u: number }>();
  return r!.u;
}

/**
 * The free stock now per `limitKey` (product and delivery day): Valio's limit less the ACCEPTED ledger lines, never below 0,
 * null when Valio's stock is unknown. The rule `approve` enforces, read without events or writes (the approval page uses it). A Valio
 * failure is an OrderError 502.
 */
export async function freeStock(env: Env, lines: OfferLine[], at: Date, fetchFn: typeof fetch = fetch): Promise<Map<string, number | null>> {
  const { limits } = await limitsFrom(env, lines, at, await fetchLineOffers(env, lines, fetchFn));
  const out = new Map<string, number | null>();
  for (const [k, limit] of limits) {
    const [productId, deliveryDate] = k.split('|');
    out.set(k, limit === null ? null : Math.max(0, round3(limit - (await acceptedUnits(env, productId, deliveryDate)))));
  }
  return out;
}

/** The checks whose free stock (limit less accepted lines, now) is below what the order needs, with what is left. */
async function shortChecks(env: Env, checks: Check[]): Promise<{ productId: string; needed: number; remaining: number }[]> {
  const out: { productId: string; needed: number; remaining: number }[] = [];
  for (const c of checks) {
    if (c.limit === null) continue;
    const remaining = c.limit - (await acceptedUnits(env, c.productId, c.deliveryDate));
    if (remaining < c.needed - EPS) out.push({ productId: c.productId, needed: c.needed, remaining: Math.max(0, round3(remaining)) });
  }
  return out;
}

/**
 * What an earlier request with the same idempotency key left: the same body gets its stored reply verbatim (rebuilt from the
 * row when the order was committed but the reply was never written), another body is 422, an order still being placed is 409.
 * A PLACING row older than a minute belonged to a dead invocation: it is deleted and null is returned so the caller retries.
 */
async function earlierReply(env: Env, buyerId: string, key: string, hash: string, at: Date): Promise<PlaceReply | null> {
  const r = await db(env).prepare('SELECT * FROM orders WHERE buyer_id = ? AND idempotency_key = ?').bind(buyerId, key).first<Row & { created_at: string }>();
  if (!r) throw new OrderError(409, 'IDEMPOTENCY_CONFLICT', 'a request with this key is in progress');
  if (r.request_hash !== hash) throw new OrderError(422, 'IDEMPOTENCY_KEY_REUSED', 'this Idempotency-Key was used with a different request body');
  if (r.reply) return JSON.parse(r.reply) as PlaceReply;
  if (r.state !== 'PLACING') return (await finalize(env, r)).reply;
  if (at.getTime() - Date.parse(r.created_at) > PLACING_TTL_MS) {
    await db(env).prepare("DELETE FROM orders WHERE id = ? AND state = 'PLACING'").bind(r.id).run();
    return null;
  }
  throw new OrderError(409, 'IDEMPOTENCY_IN_PROGRESS', 'a request with this key is still being processed');
}

/**
 * Turns a committed order row into its reply and stores it: an AUTO order the batch downgraded to HELD gains OVER_DAY_AUTO,
 * a STOCK_TAKEN rejection gains the short products (read again from the ledger against the limits kept in the body) with
 * `available`, and an order the in-batch hard day limit rejected gains OVER_DAY_HARD. Used by the placing request and by a
 * retry that finds an order whose reply was never written.
 */
async function finalize(env: Env, row: Row): Promise<{ reply: PlaceReply; decision: Decision; shorts: Awaited<ReturnType<typeof shortChecks>> }> {
  let decision = JSON.parse(row.decision ?? '{"outcome":"REJECT","reasons":[]}') as Decision;
  const extra: Pick<PlaceReply, 'available' | 'retryable' | 'resolution'> = {};
  let shorts: Awaited<ReturnType<typeof shortChecks>> = [];
  if (row.state === 'HELD' && decision.outcome === 'AUTO') {
    decision = { outcome: 'NEEDS_APPROVAL', reasons: [{ code: 'OVER_DAY_AUTO', detail: 'the day total crossed the automatic limit while this order was placed' }] };
  } else if (row.state === 'REJECTED' && row.reason === 'STOCK_TAKEN') {
    shorts = await shortChecks(env, (JSON.parse(row.body) as { checks: Check[] }).checks);
    const detail = shorts.map((s) => `${s.productId}: ${s.remaining} available, ${s.needed} needed`).join('; ');
    decision = { outcome: 'REJECT', reasons: [...decision.reasons.filter((r) => r.code !== 'STOCK_TAKEN'), { code: 'STOCK_TAKEN', detail }] };
    Object.assign(extra, { available: shorts[0]?.remaining ?? 0, retryable: false, resolution: 'requote' as const });
  } else if (row.state === 'REJECTED' && row.reason === 'OVER_DAY_HARD' && decision.outcome !== 'REJECT') {
    decision = { outcome: 'REJECT', reasons: [...decision.reasons, { code: 'OVER_DAY_HARD', detail: 'the day total crossed the hard limit while this order was placed' }] };
  }
  const reply: PlaceReply = { ...(await signedView(env, { ...row, decision: JSON.stringify(decision) })), ...extra };
  await db(env).prepare('UPDATE orders SET decision = ?, reply = ? WHERE id = ?').bind(JSON.stringify(decision), JSON.stringify(reply), row.id).run();
  return { reply, decision, shorts };
}

/**
 * Finds the quotes and offers a request chose and the needs of a basket it left out. Single: the quote must be the buyer's
 * (404) and hold the offer (400). Basket: the basket must be the buyer's (404), at least one selection is needed and each
 * must come from the basket, once (400); a need with no selection becomes an unmet entry carrying that quote's first
 * rejection code, or NOT_SELECTED when it had offers. A selection that carries `quoteJws` is refused 422
 * QUOTE_SIGNATURE_INVALID unless the door's signature verifies and its claims equal `offerClaims` of the stored offer.
 */
async function resolvePicks(env: Env, req: PlaceRequest): Promise<{ picks: { quote: Quote; offer: Offer }[]; unmet: Unmet[] }> {
  const pick = async (buyerId: string, { quoteId, offerId, quoteJws }: Selection) => {
    const quote = await getQuote(env, buyerId, quoteId);
    if (!quote) throw new OrderError(404, 'QUOTE_NOT_FOUND', `no quote ${quoteId}`);
    const offer = quote.offers.find((o) => o.offerId === offerId);
    if (!offer) throw new OrderError(400, 'OFFER_NOT_IN_QUOTE', `quote ${quoteId} has no offer ${offerId}`);
    if (quoteJws !== undefined) {
      const claims = await verifyJws(env, quoteJws, AUD.quote);
      if (!claims || canonicalJson(claims) !== canonicalJson(offerClaims(quote, offer))) {
        throw new OrderError(422, 'QUOTE_SIGNATURE_INVALID', `the quoteJws is not the door's signature over offer ${offerId} of quote ${quoteId} as stored`);
      }
    }
    return { quote, offer };
  };
  if ('quoteId' in req) return { picks: [await pick(req.buyerId, req)], unmet: [] };

  const basket = await db(env).prepare('SELECT body FROM baskets WHERE id = ? AND buyer_id = ?').bind(req.basketId, req.buyerId).first<{ body: string }>();
  if (!basket) throw new OrderError(404, 'BASKET_NOT_FOUND', `no basket ${req.basketId}`);
  const { quoteIds } = JSON.parse(basket.body) as { quoteIds: string[] };
  const chosen = req.selections.map((s) => s.quoteId);
  if (!chosen.length || new Set(chosen).size !== chosen.length || chosen.some((q) => !quoteIds.includes(q))) {
    throw new OrderError(400, 'BAD_SELECTION', 'select at least one offer, each from a different quote of the basket');
  }
  const picks = [];
  for (const s of req.selections) picks.push(await pick(req.buyerId, s));
  const unmet: Unmet[] = [];
  for (const id of quoteIds.filter((q) => !chosen.includes(q))) {
    const quote = (await getQuote(env, req.buyerId, id))!;
    const rejection = quote.offers.length ? undefined : quote.rejections[0];
    unmet.push({ need: quote.understoodAs, code: rejection?.code ?? 'NOT_SELECTED', detail: rejection?.detail ?? 'offers were available but none was chosen' });
  }
  return { picks, unmet };
}

/** The buyer's committed (ACCEPTED) and pending (HELD) net cents for a delivery day. */
async function dayTotals(env: Env, buyerId: string, date: string): Promise<{ committed: number; pending: number }> {
  const { results } = await db(env).prepare("SELECT state, COALESCE(SUM(net_cents), 0) AS cents FROM orders WHERE buyer_id = ? AND delivery_date = ? AND state IN ('ACCEPTED','HELD') GROUP BY state")
    .bind(buyerId, date)
    .all<{ state: string; cents: number }>();
  const by = (s: string) => results.find((r) => r.state === s)?.cents ?? 0;
  return { committed: by('ACCEPTED'), pending: by('HELD') };
}

/**
 * Places an order: one quote offer, or one offer per need of a basket, becomes one order. Idempotent (the key row is
 * inserted first, so a concurrent duplicate gets 409 and never a second order). The policy decides; the commit is ONE Postgres
 * transaction (under the global write lock, `src/db.ts`) that books the order and, only when the order is ACCEPTED and every finite line still fits Valio's limit less the
 * accepted lines, inserts its lines into the ledger, otherwise rejects it STOCK_TAKEN. The day total is re-checked inside
 * that batch, so concurrent orders cannot jointly pass the daily auto limit. A quote or a held order reserves nothing.
 * A HELD order gets an approval token that only `approverInbox` reveals; no reply carries it. Without a usable signing key
 * nothing is booked.
 */
export async function placeOrder(env: Env, req: PlaceRequest, fetchFn: typeof fetch = fetch): Promise<PlaceReply> {
  const key = req.idempotencyKey;
  if (!key) throw new OrderError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'an Idempotency-Key is required');
  // the reply of a final order is signed after the ledger commit, so a missing key must stop the order before it is booked
  await doorKey(env);
  const sel = 'quoteId' in req ? [req.quoteId, req.offerId, req.quoteJws ?? null, null] : [null, null, null, req.selections.map((s) => [s.quoteId, s.offerId, s.quoteJws ?? null])];
  const hash = await sha256Hex(JSON.stringify([...sel, 'basketId' in req ? req.basketId : null, req.agentReason ?? null]));
  const id = newId('ord');
  const at = await now(env);
  const ins = await db(env).prepare(
    "INSERT INTO orders(id, buyer_id, quote_id, basket_id, idempotency_key, request_hash, state, body, created_at) VALUES (?,?,?,?,?,?, 'PLACING', '{}', ?) ON CONFLICT DO NOTHING",
  )
    .bind(id, req.buyerId, 'quoteId' in req ? req.quoteId : null, 'basketId' in req ? req.basketId : null, key, hash, helsinkiIso(at))
    .run();
  if (!ins.meta.changes) {
    const earlier = await earlierReply(env, req.buyerId, key, hash, at);
    return earlier ?? placeOrder(env, req, fetchFn);
  }
  try {
    return await commitOrder(env, id, req, at, fetchFn);
  } catch (err) {
    await db(env).prepare("DELETE FROM orders WHERE id = ? AND state = 'PLACING'").bind(id).run();
    throw err;
  }
}

/** Everything after the key row exists: resolve, decide, commit in one batch, read back, store the reply and log events. */
async function commitOrder(env: Env, id: string, req: PlaceRequest, at: Date, fetchFn: typeof fetch): Promise<PlaceReply> {
  const { picks, unmet } = await resolvePicks(env, req);
  const lines = picks.flatMap((p) => p.offer.lines);
  const net = picks.reduce((s, p) => s + p.offer.netCents, 0);
  const gross = basketGross(lines);
  const deliveryDate = lines.map((l) => l.deliveryDate).sort()[0];
  const ref: Ref = { buyerId: req.buyerId, orderId: id, ...(picks.length === 1 ? { quoteId: picks[0].quote.id } : {}) };

  let mandate: Mandate | null = null;
  let forced: Reason | null = picks.some((p) => at.getTime() > Date.parse(p.quote.expiresAt)) ? { code: 'QUOTE_EXPIRED', detail: 'a chosen quote has expired' } : null;
  try {
    mandate = await loadMandate(env, req.buyerId, { now: at, aud: MANDATE_AUD });
  } catch (err) {
    if (!(err instanceof MandateError)) throw err;
    forced ??= { code: err.code, detail: err.message };
  }

  const products: CatalogProduct[] = await getProducts(env, [...new Set(lines.map((l) => l.productId))]);
  let decision: Decision;
  if (forced || !mandate) decision = { outcome: 'REJECT', reasons: [forced!] };
  else {
    const day = await dayTotals(env, req.buyerId, deliveryDate);
    decision = decide({ offers: picks.map((p) => p.offer), drafts: picks.map((p) => p.quote.understoodAs), unmet, mandate, dayCommittedCents: day.committed, dayPendingCents: day.pending, products, now: at });
  }

  let checks: Check[] = [];
  if (decision.outcome === 'AUTO') checks = toChecks(lines, (await readLimits(env, lines, at, ref, fetchFn)).limits);

  const token = newToken();
  const hardDay = mandate?.perDay.hardCents ?? 0;
  const autoDay = mandate?.perDay.autoCents ?? 0;
  const closing = picks.map((p) => p.offer.closingTime).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const firstReject = decision.outcome === 'REJECT' ? decision.reasons[0].code : null;
  const linesJson = JSON.stringify(lines.map((l) => ({ productId: l.productId, deliveryDate: l.deliveryDate, salesUnits: l.salesUnits })));
  const checksJson = JSON.stringify(checks);
  const approver = mandate?.approver.name ?? null;

  const s = db(env);
  await s.batch([
    s.prepare(
      `WITH day AS (SELECT COALESCE(SUM(net_cents), 0) AS total FROM orders WHERE buyer_id = ?1 AND delivery_date = ?2 AND state IN ('ACCEPTED','HELD'))
       UPDATE orders SET
         state = CASE WHEN ?3 = 'REJECT' THEN 'REJECTED'
                      WHEN (SELECT total FROM day) + ?4 > ?5 THEN 'REJECTED'
                      WHEN ?3 = 'NEEDS_APPROVAL' THEN 'HELD'
                      WHEN (SELECT total FROM day) + ?4 > ?6 THEN 'HELD'
                      ELSE 'ACCEPTED' END,
         reason = CASE WHEN ?3 = 'REJECT' THEN ?7 WHEN (SELECT total FROM day) + ?4 > ?5 THEN 'OVER_DAY_HARD' END,
         net_cents = ?4, gross_cents = ?8, delivery_date = ?2, decision = ?9, body = ?10, agent_reason = ?11,
         mandate_version = ?12, approver = ?13, lines_hash = ?14, approval_token = ?15, expires_at = ?16
       WHERE id = ?17 AND state = 'PLACING'`,
    ).bind(
      req.buyerId, deliveryDate, decision.outcome, net, hardDay, autoDay, firstReject, gross, JSON.stringify(decision), JSON.stringify({ lines, unmet, checks }),
      req.agentReason ?? null, mandate?.version ?? null, approver, mandate ? await linesHash(lines, req.buyerId, mandate.version) : null, token, closing, id,
    ),
    s.prepare(`${INSERT_LINES} WHERE (SELECT state FROM orders WHERE id = ?1) = 'ACCEPTED' AND ${noShortLine(4)}`).bind(id, req.buyerId, linesJson, checksJson),
    s.prepare("UPDATE orders SET state = 'REJECTED', reason = 'STOCK_TAKEN' WHERE id = ?1 AND state = 'ACCEPTED' AND NOT EXISTS (SELECT 1 FROM order_lines WHERE order_id = ?1)").bind(id),
    s.prepare("UPDATE orders SET approval_token = NULL, expires_at = NULL, decided_at = ? WHERE id = ? AND state <> 'HELD'").bind(helsinkiIso(at), id),
  ]);

  const row = (await rowById(env, id))!;
  const { reply, decision: final, shorts } = await finalize(env, row);

  await logEvent(env, { ...ref, type: 'policy.decided', data: { outcome: final.outcome, reasons: final.reasons.map((r) => r.code) } });
  if (row.state === 'HELD') await logEvent(env, { ...ref, type: 'approval.requested', data: { orderId: id, expiresAt: row.expires_at } });
  if (row.state === 'ACCEPTED') await logEvent(env, { ...ref, type: 'order.accepted', data: { lines, netCents: net } });
  for (const s of shorts) await logEvent(env, { ...ref, type: 'stock.denied', data: { productId: s.productId, remaining: s.remaining } });
  return reply;
}

/** Loads a stored order by approval token; unknown is 404. The token never appears outside the approver inbox. */
async function byToken(env: Env, token: string): Promise<Row> {
  const r = await db(env).prepare('SELECT * FROM orders WHERE approval_token = ?').bind(token).first<Row>();
  if (!r) throw new OrderError(404, 'TOKEN_UNKNOWN', 'no order for this approval token');
  return r;
}

/** Ends a HELD order as EXPIRED with a reason at door time `at`; 409 when another request resolved it first. */
async function expireOrder(env: Env, row: Row, at: Date, reason: ReasonCode, extra: { available?: number } = {}): Promise<ApproveReply> {
  const res = await db(env).prepare("UPDATE orders SET state = 'EXPIRED', reason = ?, decided_at = ? WHERE id = ? AND state = 'HELD'").bind(reason, helsinkiIso(at), row.id).run();
  if (!res.meta.changes) throw new OrderError(409, 'TOKEN_USED', 'this approval was already resolved');
  await logEvent(env, { buyerId: row.buyer_id, orderId: row.id, type: 'approval.expired', data: {} });
  return { orderId: row.id, state: 'EXPIRED', reason, ...extra };
}

/**
 * Approves a HELD order by its token (single use). Any caller but the approver is refused (403) before anything is read. Then, in order:
 * the cut-off (ours, then Valio's: both APPROVAL_EXPIRED), Valio's current orderability (stock gone is STOCK_TAKEN, any other failure keeps its own code) and price, the token's lines binding, and finally ONE batch that moves the order
 * to ACCEPTED and writes its lines only if every finite line still fits. Approval is not a reservation: stock gone is
 * EXPIRED STOCK_TAKEN with what is left; a price that moved is EXPIRED PRICE_CHANGED; a used token is 409.
 */
export async function approve(env: Env, token: string, opts: { callerRole: 'approver' | 'agent' }, fetchFn: typeof fetch = fetch): Promise<ApproveReply> {
  if (opts?.callerRole !== 'approver') throw new OrderError(403, 'AGENT_CANNOT_APPROVE', 'only the approver can approve an order');
  const row = await byToken(env, token);
  if (row.state !== 'HELD') throw new OrderError(409, 'TOKEN_USED', 'this approval was already resolved');
  const at = await now(env);
  const { lines } = JSON.parse(row.body) as { lines: OfferLine[] };
  if (at.getTime() >= Date.parse(row.expires_at!)) return expireOrder(env, row, at, 'APPROVAL_EXPIRED');

  const ref: Ref = { buyerId: row.buyer_id, orderId: row.id, ...(row.quote_id ? { quoteId: row.quote_id } : {}) };
  const { limits, failure, offers } = await readLimits(env, lines, at, ref, fetchFn);
  if (failure === 'NOT_ORDERABLE') return expireOrder(env, row, at, 'STOCK_TAKEN', { available: 0 });
  if (failure) return expireOrder(env, row, at, failure === 'CUTOFF_PASSED' ? 'APPROVAL_EXPIRED' : failure);
  const moved = lines.some((l) => halfUp((offers.price.get(l.productId)!.catalogPrice!.value as number) * 100) !== l.netCentsPerSalesUnit);
  if (moved) return expireOrder(env, row, at, 'PRICE_CHANGED');

  let version: number;
  try {
    version = (await loadMandate(env, row.buyer_id, { now: at, aud: MANDATE_AUD })).version;
  } catch (err) {
    if (err instanceof MandateError) throw new OrderError(409, err.code, err.message);
    throw err;
  }
  if ((await linesHash(lines, row.buyer_id, version)) !== row.lines_hash) throw new OrderError(409, 'LINES_CHANGED', 'the order no longer matches what the approval was issued for');

  const checks = toChecks(lines, limits);
  const checksJson = JSON.stringify(checks);
  const linesJson = JSON.stringify(lines.map((l) => ({ productId: l.productId, deliveryDate: l.deliveryDate, salesUnits: l.salesUnits })));
  const s = db(env);
  const res = await s.batch([
    s.prepare(`UPDATE orders SET state = 'ACCEPTED', reason = NULL, decided_at = ?3 WHERE id = ?1 AND state = 'HELD' AND ${noShortLine(2)}`).bind(row.id, checksJson, helsinkiIso(at)),
    s.prepare(`${INSERT_LINES} WHERE (SELECT state FROM orders WHERE id = ?1) = 'ACCEPTED' AND NOT EXISTS (SELECT 1 FROM order_lines WHERE order_id = ?1)`).bind(row.id, row.buyer_id, linesJson),
    s.prepare("UPDATE orders SET state = 'EXPIRED', reason = 'STOCK_TAKEN', decided_at = ? WHERE id = ? AND state = 'HELD'").bind(helsinkiIso(at), row.id),
  ]);
  if (res[0].meta.changes) {
    await logEvent(env, { ...ref, type: 'approval.approved', data: {} });
    await logEvent(env, { ...ref, type: 'order.accepted', data: { lines, netCents: row.net_cents } });
    return { orderId: row.id, state: 'ACCEPTED' };
  }
  if (!res[2].meta.changes) throw new OrderError(409, 'TOKEN_USED', 'this approval was already resolved');
  const shorts = await shortChecks(env, checks);
  await logEvent(env, { ...ref, type: 'approval.expired', data: {} });
  for (const s of shorts) await logEvent(env, { ...ref, type: 'stock.denied', data: { productId: s.productId, remaining: s.remaining } });
  return { orderId: row.id, state: 'EXPIRED', reason: 'STOCK_TAKEN', available: shorts[0]?.remaining ?? 0 };
}

/** The approver (only) declines a HELD order by its token: REJECTED, once; an unknown token is 404, a used one 409. */
export async function reject(env: Env, token: string, opts: { callerRole: 'approver' | 'agent' }): Promise<ApproveReply> {
  if (opts?.callerRole !== 'approver') throw new OrderError(403, 'AGENT_CANNOT_APPROVE', 'only the approver can reject an order');
  const row = await byToken(env, token);
  const res = await db(env).prepare("UPDATE orders SET state = 'REJECTED', decided_at = ? WHERE id = ? AND state = 'HELD'").bind(helsinkiIso(await now(env)), row.id).run();
  if (!res.meta.changes) throw new OrderError(409, 'TOKEN_USED', 'this approval was already resolved');
  await logEvent(env, { buyerId: row.buyer_id, orderId: row.id, ...(row.quote_id ? { quoteId: row.quote_id } : {}), type: 'approval.rejected', data: {} });
  return { orderId: row.id, state: 'REJECTED' };
}

/**
 * The approver's inbox: the HELD orders of the buyer the approver key belongs to, each with the approval token, which is
 * revealed only here (never in an agent-facing reply or event). An unknown key is 401.
 */
export async function approverInbox(
  env: Env,
  approverKey: string,
): Promise<{ approver: string; buyerId: string; pending: { orderId: string; token: string; netCents: number; grossCents: number; approvalExpiresAt: string }[] }> {
  const who = await db(env).prepare('SELECT buyer_id, approver FROM approver_keys WHERE key_hash = ?').bind(await sha256Hex(approverKey)).first<{ buyer_id: string; approver: string }>();
  if (!who) throw new OrderError(401, 'APPROVER_KEY_UNKNOWN', 'unknown approver key');
  const { results } = await db(env).prepare("SELECT id, approval_token, net_cents, gross_cents, expires_at FROM orders WHERE buyer_id = ? AND state = 'HELD' ORDER BY created_at, id")
    .bind(who.buyer_id)
    .all<{ id: string; approval_token: string; net_cents: number; gross_cents: number; expires_at: string }>();
  return {
    approver: who.approver,
    buyerId: who.buyer_id,
    pending: results.map((r) => ({ orderId: r.id, token: r.approval_token, netCents: r.net_cents, grossCents: r.gross_cents, approvalExpiresAt: r.expires_at })),
  };
}

/**
 * Quotes several needs as one basket: one quote per need (in order) and a stored basket that expires with its earliest
 * quote. Placing the basket later turns one chosen offer per need into one order with one total and one approval.
 */
export async function createBasket(env: Env, buyerId: string, needs: unknown[], fetchFn: typeof fetch = fetch): Promise<{ basketId: string; quotes: Quote[]; expiresAt: string }> {
  if (!needs.length) throw new OrderError(400, 'EMPTY_BASKET', 'a basket needs at least one need');
  const quotes: Quote[] = [];
  for (const draft of needs) quotes.push(await createQuote(env, buyerId, { draft }, fetchFn));
  const expiresAt = quotes.map((q) => q.expiresAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const basketId = newId('b');
  await db(env).prepare('INSERT INTO baskets(id, buyer_id, body, created_at, expires_at) VALUES (?,?,?,?,?)')
    .bind(basketId, buyerId, JSON.stringify({ quoteIds: quotes.map((q) => q.id) }), helsinkiIso(await now(env)), expiresAt)
    .run();
  return { basketId, quotes, expiresAt };
}
