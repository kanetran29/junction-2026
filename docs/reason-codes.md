# Reason codes

Generated from `src/domain/reasons.ts` by `scripts/reason-codes-md.ts`. Do not edit by hand.
The same table is served live at `GET /v1/reason-codes`.

- `recoverable`: the same call may work if repeated, or after a new quote.
- `requires_buyer_input`: the buyer must change the request.
- `requires_buyer_review`: a human must look before the order goes ahead.
- Retryable: whether the same request may succeed if sent again.

| Code | Text | Resolution | Retryable |
|---|---|---|---|
| `CUTOFF_PASSED` | The order cut-off for this product has passed for the requested delivery. | `requires_buyer_input` | no |
| `NOT_ORDERABLE` | Valio shows no stock or schedule for this product. | `requires_buyer_input` | no |
| `SALES_BLOCKED` | Valio has blocked sales of this product. | `requires_buyer_input` | no |
| `STOCK_LIMITED` | Not enough stock is available for the requested quantity, so this product was rejected. | `requires_buyer_review` | no |
| `PRICE_UNAVAILABLE` | Valio returned no valid price for this product. | `requires_buyer_input` | yes |
| `NOT_CONVERTIBLE` | The requested quantity cannot be converted into whole sales units of this product. | `requires_buyer_input` | no |
| `SUBTYPE_MISMATCH` | The product is a different kind of product than the one requested. | `requires_buyer_input` | no |
| `CLAIM_MISSING` | The product does not carry a claim the request requires. | `requires_buyer_input` | no |
| `BRAND_EXCLUDED` | The product is from a brand the request excludes. | `requires_buyer_input` | no |
| `DATE_NOT_MET` | The product cannot be delivered by the requested date. | `requires_buyer_input` | no |
| `PACK_SIZE_CHANGED` | The pack size differs from the one originally ordered. | `requires_buyer_review` | no |
| `BRAND_CHANGED` | The brand differs from the one originally ordered. | `requires_buyer_review` | no |
| `SUBSTITUTE` | A substitute product replaces the one requested. | `requires_buyer_review` | no |
| `SHORTFALL` | Less than the requested quantity can be delivered. | `requires_buyer_review` | no |
| `OVER_ORDER_AUTO` | The order exceeds the automatic limit per order, so a human must approve it. | `requires_buyer_review` | no |
| `OVER_ORDER_HARD` | The order exceeds the hard limit per order and cannot be placed. | `requires_buyer_input` | no |
| `OVER_DAY_AUTO` | The day total exceeds the automatic daily limit, so a human must approve it. | `requires_buyer_review` | no |
| `OVER_DAY_HARD` | The day total exceeds the hard daily limit and the order cannot be placed. | `requires_buyer_input` | no |
| `NEW_ALLERGEN` | The product contains an allergen the original did not. | `requires_buyer_review` | no |
| `RELIABILITY_UNKNOWN` | There is no delivery reliability record for this product. | `requires_buyer_review` | no |
| `RELIABILITY_LOW` | This product has a low delivery reliability record. | `requires_buyer_review` | no |
| `QUOTE_EXPIRED` | The quote has expired; request a new one. | `recoverable` | yes |
| `APPROVAL_EXPIRED` | The approval was not given in time and has expired. | `recoverable` | yes |
| `UPSTREAM_ERROR` | Valio did not answer correctly; try again shortly. | `recoverable` | yes |
| `VALIO_RATE_LIMITED` | Valio asked us to slow down; nothing to change, retry after the wait. | `recoverable` | yes |
| `TEMP_CLASS_CHANGED` | The storage temperature class differs from the original product. | `requires_buyer_review` | no |
| `ALLERGEN_UNKNOWN` | The allergen information for the product is missing, so it cannot be checked. | `requires_buyer_review` | no |
| `MANDATE_INVALID` | The buyer mandate is missing or its signature does not verify. | `requires_buyer_input` | no |
| `MANDATE_EXPIRED` | The buyer mandate has expired. | `requires_buyer_input` | no |
| `STOCK_TAKEN` | The stock was taken by another order before this one was accepted. | `requires_buyer_input` | no |
| `PRICE_CHANGED` | The price changed since the quote. | `recoverable` | yes |
| `PARTIAL_BASKET` | Only part of the basket could be quoted. | `requires_buyer_review` | no |
| `SUBTYPE_UNVERIFIED` | The product type could not be confirmed against a reviewed subtype. | `requires_buyer_review` | no |
| `NOT_SELECTED` | The basket offered options for this need but none was chosen. | `requires_buyer_review` | no |
| `BRAND_NOT_CARRIED` | Valio does not carry the requested brand. | `requires_buyer_input` | no |
| `TRY_RATE_LIMITED` | Try it is limited per visitor, per address and for everyone (free text most, since it uses the shared models); wait retryAfter seconds. | `recoverable` | yes |
| `MODELS_BUSY` | Gemini is over its request quota right now; retry after retryAfter seconds (in Try it, the example sentences need no model call). | `recoverable` | yes |
| `TRANSCRIPT_EMPTY` | The spoken clip held no clear speech, so nothing was transcribed; record it again or type the request. | `requires_buyer_input` | no |
| `QUOTE_SIGNATURE_INVALID` | The quote signature sent with the order does not verify against the door's key or does not match the offer as quoted. | `requires_buyer_input` | no |
