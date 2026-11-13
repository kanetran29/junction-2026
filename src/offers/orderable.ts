import type { ReasonCode } from '../domain/reasons';
import type { AvailabilityRow, PriceRow } from '../valio/client';

const UNLIMITED = 999999;

/** Valio marks unlimited stock with 999999 (Terminal) or 1e10 (Stock); anything at or above the sentinel is unlimited. */
export function isUnlimited(amount: number): boolean {
  return amount >= UNLIMITED;
}

export type Orderable =
  | { ok: true; limit: number | null; closingTime: string; deliveryDate: string }
  | { ok: false; code: ReasonCode; detail: string };

const no = (code: ReasonCode, detail: string): Orderable => ({ ok: false, code, detail });

/**
 * Whether a product can be ordered at `now` for delivery by `deliverBy` (YYYY-MM-DD), following the oracle's checks in
 * order: price, then a positive schedule line in the product's own sales unit, then blocks, cut-off and delivery date.
 * `limit` is the sum of the unblocked amounts, or null when stock is unlimited.
 */
export function orderable(
  av: AvailabilityRow,
  price: PriceRow | undefined,
  now: Date,
  deliverBy: string,
  product: { salesUnit: string | null },
): Orderable {
  const cp = price?.catalogPrice;
  if (!price || price.error || !cp || !((cp.value ?? 0) > 0) || (cp.validTo && Date.parse(cp.validTo) < now.getTime())) {
    return no('PRICE_UNAVAILABLE', 'Valio returned no valid price');
  }
  const positive = (av.scheduleLines ?? []).filter((s) => s.availableAmount > 0);
  const lines = positive.filter((s) => !product.salesUnit || !s.salesUnit || s.salesUnit === product.salesUnit);
  if (!lines.length) {
    const other = positive.map((s) => s.salesUnit).join(', ');
    return no('NOT_ORDERABLE', positive.length ? `stock is in ${other}, the product is sold in ${product.salesUnit}` : 'no stock lines');
  }
  if (av.salesBlock || lines.every((s) => s.salesBlock)) return no('SALES_BLOCKED', 'sales are blocked');
  if (!av.closingTime || Date.parse(av.closingTime) <= now.getTime()) return no('CUTOFF_PASSED', `cut-off was ${av.closingTime ?? 'not set'}`);
  const deliveryDate = lines.map((s) => String(s.availableDate).slice(0, 10)).sort()[0];
  if (deliveryDate > deliverBy) return no('DATE_NOT_MET', `earliest delivery ${deliveryDate}, needed by ${deliverBy}`);
  const amount = lines.filter((s) => !s.salesBlock).reduce((sum, s) => sum + s.availableAmount, 0);
  return { ok: true, limit: isUnlimited(amount) ? null : amount, closingTime: av.closingTime, deliveryDate };
}
