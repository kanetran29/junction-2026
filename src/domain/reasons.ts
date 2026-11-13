export type Resolution = 'recoverable' | 'requires_buyer_input' | 'requires_buyer_review';

export interface ReasonInfo {
  text: string;
  resolution: Resolution;
  retryable: boolean;
}

const r = (text: string, resolution: Resolution, retryable = false): ReasonInfo => ({ text, resolution, retryable });

/**
 * Every reason code the gateway can attach to a rejection, a change or an approval: one human sentence,
 * who can resolve it, and whether the same request may work if retried. `/v1/reason-codes` serves this table as is.
 */
export const REASONS = {
  CUTOFF_PASSED: r('The order cut-off for this product has passed for the requested delivery.', 'requires_buyer_input'),
  NOT_ORDERABLE: r('Valio shows no stock or schedule for this product.', 'requires_buyer_input'),
  SALES_BLOCKED: r('Valio has blocked sales of this product.', 'requires_buyer_input'),
  STOCK_LIMITED: r('Less stock is available than requested, so the quantity was reduced.', 'requires_buyer_review'),
  PRICE_UNAVAILABLE: r('Valio returned no valid price for this product.', 'requires_buyer_input', true),
  NOT_CONVERTIBLE: r('The requested quantity cannot be converted into whole sales units of this product.', 'requires_buyer_input'),
  UNIT_MISMATCH: r('The requested unit does not match the unit this product is sold in.', 'requires_buyer_input'),
  SUBTYPE_MISMATCH: r('The product is a different kind of product than the one requested.', 'requires_buyer_input'),
  CLAIM_MISSING: r('The product does not carry a claim the request requires.', 'requires_buyer_input'),
  BRAND_EXCLUDED: r('The product is from a brand the request excludes.', 'requires_buyer_input'),
  DATE_NOT_MET: r('The product cannot be delivered by the requested date.', 'requires_buyer_input'),
  PACK_SIZE_CHANGED: r('The pack size differs from the one originally ordered.', 'requires_buyer_review'),
  BRAND_CHANGED: r('The brand differs from the one originally ordered.', 'requires_buyer_review'),
  SUBSTITUTE: r('A substitute product replaces the one requested.', 'requires_buyer_review'),
  SHORTFALL: r('Less than the requested quantity can be delivered.', 'requires_buyer_review'),
  OVER_ORDER_AUTO: r('The order exceeds the automatic limit per order, so a human must approve it.', 'requires_buyer_review'),
  OVER_ORDER_HARD: r('The order exceeds the hard limit per order and cannot be placed.', 'requires_buyer_input'),
  OVER_DAY_AUTO: r('The day total exceeds the automatic daily limit, so a human must approve it.', 'requires_buyer_review'),
  OVER_DAY_HARD: r('The day total exceeds the hard daily limit and the order cannot be placed.', 'requires_buyer_input'),
  NEW_ALLERGEN: r('The product contains an allergen the original did not.', 'requires_buyer_review'),
  RELIABILITY_UNKNOWN: r('There is no delivery reliability record for this product.', 'requires_buyer_review'),
  RELIABILITY_LOW: r('This product has a low delivery reliability record.', 'requires_buyer_review'),
  QUOTE_EXPIRED: r('The quote has expired; request a new one.', 'recoverable', true),
  APPROVAL_EXPIRED: r('The approval was not given in time and has expired.', 'recoverable', true),
  UPSTREAM_ERROR: r('Valio did not answer correctly; try again shortly.', 'recoverable', true),
  TEMP_CLASS_CHANGED: r('The storage temperature class differs from the original product.', 'requires_buyer_review'),
  ALLERGEN_UNKNOWN: r('The allergen information for the product is missing, so it cannot be checked.', 'requires_buyer_review'),
  MANDATE_INVALID: r('The buyer mandate is missing or its signature does not verify.', 'requires_buyer_input'),
  MANDATE_EXPIRED: r('The buyer mandate has expired.', 'requires_buyer_input'),
  STOCK_TAKEN: r('The stock was taken by another order before this one was accepted.', 'requires_buyer_input'),
  PRICE_CHANGED: r('The price changed since the quote.', 'recoverable', true),
  PARTIAL_BASKET: r('Only part of the basket could be quoted.', 'requires_buyer_review'),
  SUBTYPE_UNVERIFIED: r('The product type could not be confirmed against a reviewed subtype.', 'requires_buyer_review'),
  BRAND_NOT_CARRIED: r('Valio does not carry the requested brand.', 'requires_buyer_input'),
} as const satisfies Record<string, ReasonInfo>;

export type ReasonCode = keyof typeof REASONS;
