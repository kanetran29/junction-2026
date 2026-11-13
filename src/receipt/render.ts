import type { CatalogProduct } from '../catalog/search';
import { halfUp } from '../domain/money';
import { REASONS, type ReasonCode } from '../domain/reasons';
import type { Order } from '../orders/store';
import type { Decision } from '../policy/decide';
import type { Draft, OfferLine, Quote } from '../quote/build';

/** Euro amount from cents with en-US grouping and two decimals: `101000` becomes `1,010.00`. */
export function eur(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A quantity with en-US grouping and at most three decimals: `1000` becomes `1,000`. */
export function qty(x: number): string {
  return x.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/** A product's display name: English, else Finnish, else its id. */
export function productName(products: CatalogProduct[], id: string): string {
  const names = products.find((p) => p.id === id)?.names ?? [];
  return (names.find((n) => n.language === 'en') ?? names.find((n) => n.language === 'fi'))?.value ?? id;
}

/** The line net in cents: unit price times sales units, rounded half up (the same figure on the receipt and the approval page). */
export const lineNet = (l: OfferLine) => halfUp(l.netCentsPerSalesUnit * l.salesUnits);

/**
 * The plain-text receipt of an order, built only from templates (no model): one block per line (product, sales units times
 * content, fixed price per litre or kilo, line net), the net and gross totals, the decision's reasons in their human text,
 * the state, why it ended when it did not end accepted (`reason`) and who approved or rejected. Only an ACCEPTED order is called binding. `products` supply the names; `approver` is the
 * mandate approver's name.
 */
export function renderReceipt(order: Order, quotes: Quote[], drafts: Draft[], decision: Decision, opts: { products: CatalogProduct[]; approver: string; reason?: string }): string {
  const wantedPack = drafts.find((d) => d.packLitres)?.packLitres;
  const packChanged = decision.reasons.some((r) => r.code === 'PACK_SIZE_CHANGED');
  const out = [`Lazydoor receipt ${order.id}`, `State: ${order.state}`];
  if (quotes.length) out.push(`Quote: ${quotes.map((q) => q.id).join(', ')}`);
  if (order.deliveryDate) out.push(`Delivery: ${order.deliveryDate}`);
  for (const l of order.lines) {
    const perUnit = (l.netCentsPerSalesUnit / l.contentPerSalesUnit / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
    out.push('', `${l.productId} ${productName(opts.products, l.productId)}`, `  ${qty(l.salesUnits)} × ${qty(l.contentPerSalesUnit)} ${l.contentUnit}`);
    if (packChanged && wantedPack && wantedPack !== l.contentPerSalesUnit) out.push(`  pack requested ${qty(wantedPack)} l, delivered ${qty(l.contentPerSalesUnit)} ${l.contentUnit}`);
    out.push(`  Fixed price ${perUnit} EUR/${l.contentUnit}`, `  Line net ${eur(lineNet(l))} EUR`);
  }
  out.push('', `Net ${eur(order.netCents)} EUR`, `Gross ${eur(order.grossCents)} EUR`);
  if (decision.reasons.length) out.push('', 'Why:', ...decision.reasons.map((r) => `  ${r.code}: ${REASONS[r.code].text}`));
  out.push('');
  if (order.state === 'ACCEPTED') {
    out.push(decision.outcome === 'NEEDS_APPROVAL' ? `Approved by ${opts.approver}` : 'Order accepted within the mandate', 'Accepted = binding order, invoiced on delivery (simulated)');
  } else if (order.state === 'HELD') out.push(`Waiting for approval by ${opts.approver}`);
  else {
    const why = opts.reason && opts.reason in REASONS ? REASONS[opts.reason as ReasonCode].text : null;
    if (why) out.push(`Ended: ${why}`);
    else if (order.state === 'REJECTED' && decision.outcome !== 'REJECT') out.push(`Rejected by ${opts.approver}`);
  }
  return out.join('\n');
}
