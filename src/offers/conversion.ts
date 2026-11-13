import type { NameContent } from '../catalog/search';
import type { PriceRow } from '../valio/client';

export type Unit = 'l' | 'kg';

export interface Quantity {
  value: number;
  unit: Unit | 'pcs';
}

type ContentSource = { nameContent: NameContent | null; unitsPerSales: number | null };

const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;
const within2 = (a: number, b: number) => Math.abs(a - b) / b < 0.02;

/**
 * Litres or kilos in one sales unit, from catalogPrice / comparisonPrice (rounded to 3 decimals like the oracle),
 * snapped to the name content (alone or times the pieces per sales unit) or to one decimal when within 2 %
 * (4.998 -> 5). Null when there is no L/KG comparison unit or the ratio agrees with neither: NOT_CONVERTIBLE.
 */
export function contentPerSalesUnit(product: ContentSource, price: PriceRow): { value: number; unit: Unit } | null {
  const unit = price.comparisonUnit?.toLowerCase();
  const cat = price.catalogPrice?.value;
  const cmp = price.comparisonPrice?.value;
  if ((unit !== 'l' && unit !== 'kg') || !cat || !cmp) return null;
  const raw = round(cat / cmp, 3);
  const name = product.nameContent?.totalUnit === unit ? product.nameContent.total : null;
  const targets = name ? [name, round(name * (product.unitsPerSales ?? 1), 6)] : [];
  const hit = targets.find((t) => t > 0 && within2(raw, t));
  if (hit !== undefined) return { value: hit, unit };
  const near = round(raw, 1);
  return near > 0 && within2(raw, near) ? { value: near, unit } : null;
}

/**
 * Whole sales units covering `qty` of a product holding `content` per sales unit. A lot step (in SALES units, as Valio's
 * allowedLotSize; null when the product has none) makes the order a whole number of lots, each `lotStep` sales units
 * (`lotStep * content` litres or kilos). Only a quantity in the content's own unit converts: `pcs` (or litres for a
 * kilo product) is NOT_CONVERTIBLE.
 */
export function fillQuantity(
  qty: Quantity,
  content: { value: number; unit: Unit },
  lotStep: number | null,
): { salesUnits: number; filled: number; overage: number } | { code: 'NOT_CONVERTIBLE' } {
  if (qty.unit !== content.unit) return { code: 'NOT_CONVERTIBLE' };
  const step = lotStep === null ? content.value : lotStep * content.value;
  const salesUnits = round(Math.ceil(round(qty.value / step, 6)) * (step / content.value), 6);
  const filled = round(salesUnits * content.value, 3);
  return { salesUnits, filled, overage: round(filled - qty.value, 3) };
}
