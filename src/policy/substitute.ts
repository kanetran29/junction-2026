import type { CatalogProduct } from '../catalog/search';
import type { ReasonCode } from '../domain/reasons';

export type SubstituteCheck =
  | { ok: true; allergensUnknown: boolean }
  | { ok: false; code: Extract<ReasonCode, 'NEW_ALLERGEN' | 'CLAIM_MISSING' | 'TEMP_CLASS_CHANGED'>; detail: string };

/**
 * Whether `sub` may stand in for `reference`: it must add no CONTAINS allergen, keep every claim of the reference and
 * stay in its temperature class (first failure wins, in that order). When either side has no allergen data at all the
 * two cannot be compared, so the substitute passes with `allergensUnknown` set and the offer must say so (ALLERGEN_UNKNOWN).
 */
export function checkSubstitute(reference: CatalogProduct, sub: CatalogProduct): SubstituteCheck {
  const a = reference.allergens;
  /** True when a product carries no allergen data of any kind. */
  const none = (x: CatalogProduct['allergens']) => !x.contains.length && !x.mayContain.length && !x.freeFrom.length;
  const allergensUnknown = none(a) || none(sub.allergens);
  const added = allergensUnknown ? [] : sub.allergens.contains.filter((x) => !a.contains.includes(x));
  if (added.length) return { ok: false, code: 'NEW_ALLERGEN', detail: `adds allergen ${added.join(', ')}` };
  const lost = reference.claims.filter((c) => !sub.claims.includes(c));
  if (lost.length) return { ok: false, code: 'CLAIM_MISSING', detail: `lacks ${lost.join(', ')}` };
  if (reference.tempClass !== null && sub.tempClass !== null && reference.tempClass !== sub.tempClass) {
    return { ok: false, code: 'TEMP_CLASS_CHANGED', detail: `temperature class ${sub.tempClass}, reference ${reference.tempClass}` };
  }
  return { ok: true, allergensUnknown };
}
