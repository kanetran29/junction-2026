import type { CatalogProduct } from '../catalog/search';
import type { Mandate } from '../domain/constants';
import type { ReasonCode } from '../domain/reasons';
import type { Draft, Offer } from '../quote/build';

/** One reason behind a decision: a published code and, when useful, what it concerns. */
export interface Reason {
  code: ReasonCode;
  detail?: string;
}

export interface Decision {
  outcome: 'AUTO' | 'NEEDS_APPROVAL' | 'REJECT';
  reasons: Reason[];
}

/** A need of a basket that no chosen offer covers: the need as understood, why it is missing and what the quote said. */
export interface Unmet {
  need: Draft;
  code: ReasonCode;
  detail: string;
}

export interface DecideInput {
  /** The chosen offers, one per need; `drafts[i]` is the need `offers[i]` answers. */
  offers: Offer[];
  drafts: Draft[];
  unmet: Unmet[];
  mandate: Mandate;
  /** Net cents of the buyer's ACCEPTED orders for the delivery day, and of the HELD ones. */
  dayCommittedCents: number;
  dayPendingCents: number;
  /** Catalogue rows of every product in the offers. */
  products: CatalogProduct[];
  /** The clock, when the mandate expiry should be checked here as well (placeOrder has already loaded a live mandate). */
  now?: Date;
}

const APPROVAL_CHANGES: ReasonCode[] = ['PACK_SIZE_CHANGED', 'SUBSTITUTE', 'SHORTFALL', 'SUBTYPE_UNVERIFIED', 'ALLERGEN_UNKNOWN'];

/**
 * The policy: weighs the basket (all chosen offers together) against the buyer's signed mandate. Reasons accumulate;
 * any hard limit, lost claim, new allergen (when the mandate forbids it) or expired mandate makes the outcome REJECT,
 * else any approval reason makes it NEEDS_APPROVAL, else AUTO. The NEW_ALLERGEN branch is defence in depth: the quote
 * already rejects a substitute that adds an allergen, so it only fires for an offer built elsewhere. Pure: the caller supplies the day's committed and held totals.
 */
export function decide(i: DecideInput): Decision {
  const { mandate: m } = i;
  const reject: Reason[] = [];
  const approve: Reason[] = [];
  const add = (list: Reason[], r: Reason) => {
    if (!list.some((x) => x.code === r.code && x.detail === r.detail)) list.push(r);
  };

  if (i.now && i.now.getTime() >= Date.parse(m.exp)) add(reject, { code: 'MANDATE_EXPIRED', detail: `mandate expired ${m.exp}` });

  const net = i.offers.reduce((s, o) => s + o.netCents, 0);
  if (net > m.perOrder.hardCents) add(reject, { code: 'OVER_ORDER_HARD', detail: `${net} cents, hard limit ${m.perOrder.hardCents}` });
  else if (net > m.perOrder.autoCents) add(approve, { code: 'OVER_ORDER_AUTO', detail: `${net} cents, auto limit ${m.perOrder.autoCents}` });

  const day = i.dayCommittedCents + i.dayPendingCents + net;
  if (day > m.perDay.hardCents) add(reject, { code: 'OVER_DAY_HARD', detail: `${day} cents for the day, hard limit ${m.perDay.hardCents}` });
  else if (day > m.perDay.autoCents) add(approve, { code: 'OVER_DAY_AUTO', detail: `${day} cents for the day, auto limit ${m.perDay.autoCents}` });

  const byId = new Map(i.products.map((p) => [p.id, p]));
  i.offers.forEach((o, k) => {
    const required = i.drafts[k]?.claims ?? [];
    for (const line of o.lines) {
      const have = byId.get(line.productId)?.claims ?? [];
      const missing = required.filter((c) => !have.includes(c));
      if (missing.length) add(reject, { code: 'CLAIM_MISSING', detail: `${line.productId} lacks ${missing.join(', ')}` });
    }
    for (const c of o.changes) {
      if (c === 'NEW_ALLERGEN') add(m.noNewAllergen ? reject : approve, { code: c });
      else if (APPROVAL_CHANGES.includes(c)) add(approve, { code: c });
    }
    const { value } = o.reliability;
    if (value !== null && value < m.reliabilityFloor) add(approve, { code: 'RELIABILITY_LOW' });
    else if (value === null && m.reliabilityUnknown === 'approve') add(approve, { code: 'RELIABILITY_UNKNOWN' });
  });

  if (i.unmet.length) add(approve, { code: 'PARTIAL_BASKET', detail: `${i.unmet.length} need(s) without an offer` });

  const reasons = [...reject, ...approve];
  return { outcome: reject.length ? 'REJECT' : approve.length ? 'NEEDS_APPROVAL' : 'AUTO', reasons };
}
