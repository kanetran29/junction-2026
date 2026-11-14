import type { CatalogProduct } from '../catalog/search';
import type { Order } from '../orders/store';
import { lineNet } from '../domain/money';
import { productName } from '../receipt/render';

/** Peppol BIS Order 3.0, transaction Trdm01 ("Order only" profile, no order response); source https://docs.peppol.eu/poacc/upgrade-3/profiles/28-ordering/ (section 8.2). */
export const PEPPOL_CUSTOMIZATION_ID = 'urn:fdc:peppol.eu:poacc:trns:order:3';
/** The profile of the same page: the ordering BIS 3. */
export const PEPPOL_PROFILE_ID = 'urn:fdc:peppol.eu:poacc:bis:ordering:3';

/** UN/ECE Recommendation 20 unit codes of the sales units the catalogue uses; anything else is "one" (C62). */
const UNIT_CODES: Record<string, string> = { ST: 'H87', KI: 'KGM', KG: 'KGM', L: 'LTR', PAK: 'XPK' };

/** What the export needs besides the order: the buyer, when the order was decided (Helsinki ISO time) and the catalogue rows of its products. */
export interface PeppolContext {
  buyerId: string;
  decidedAt: string;
  products: CatalogProduct[];
}

/**
 * Escapes a value for XML text and attributes: the five markup characters become entities and the control characters XML 1.0
 * forbids are dropped, so any product name or id keeps the document well-formed.
 */
export function escapeXml(s: unknown): string {
  return String(s)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** Cents as a decimal amount with two places: `101000` becomes `1010.00`. */
const amount = (cents: number): string => (cents / 100).toFixed(2);

/** A money element with the EUR currency attribute. */
const money = (tag: string, cents: number): string => `<cbc:${tag} currencyID="EUR">${amount(cents)}</cbc:${tag}>`;

/** A number without float noise (at most six decimals), for quantities and VAT percentages. */
const num = (x: number): string => String(Math.round(x * 1e6) / 1e6);

/**
 * One party of the order with a clearly labelled demo endpoint: Lazydoor holds no Peppol participant id for either side, so
 * the EndpointID is a placeholder that names itself as one.
 */
function party(wrapper: 'BuyerCustomerParty' | 'SellerSupplierParty', endpoint: string, name: string): string {
  return `<cac:${wrapper}><cac:Party><cbc:EndpointID schemeID="0088">${escapeXml(`DEMO-PLACEHOLDER-${endpoint}`)}</cbc:EndpointID><cac:PartyName><cbc:Name>${escapeXml(name)}</cbc:Name></cac:PartyName><cac:PostalAddress><cac:Country><cbc:IdentificationCode>FI</cbc:IdentificationCode></cac:Country></cac:PostalAddress></cac:Party></cac:${wrapper}>`;
}

/**
 * One order line as a Peppol OrderLine: quantity in sales units with its UN/ECE unit code, the line net, the price per sales
 * unit, and the item (name, Valio product id, the sales-unit GTIN as scheme 0160 when the catalogue has one, and the VAT rate).
 */
function orderLine(l: Order['lines'][number], n: number, products: CatalogProduct[]): string {
  const gtin = products.find((p) => p.id === l.productId)?.salesUnitGtin;
  const unit = UNIT_CODES[l.salesUnit ?? ''] ?? 'C62';
  const std = gtin ? `<cac:StandardItemIdentification><cbc:ID schemeID="0160">${escapeXml(gtin)}</cbc:ID></cac:StandardItemIdentification>` : '';
  return `<cac:OrderLine><cac:LineItem><cbc:ID>${n}</cbc:ID><cbc:Quantity unitCode="${unit}">${num(l.salesUnits)}</cbc:Quantity>${money('LineExtensionAmount', lineNet(l))}<cac:Price>${money('PriceAmount', l.netCentsPerSalesUnit)}</cac:Price><cac:Item><cbc:Name>${escapeXml(productName(products, l.productId))}</cbc:Name><cac:SellersItemIdentification><cbc:ID>${escapeXml(l.productId)}</cbc:ID></cac:SellersItemIdentification>${std}<cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>${num(l.taxRate)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item></cac:LineItem></cac:OrderLine>`;
}

/**
 * The Peppol BIS Order 3.0 (UBL 2.1 Order, "Order only") document of an accepted order, as one XML string. Pure: the order
 * and its catalogue rows in, text out, so it runs anywhere. Totals are the order's own `netCents` and `grossCents` (the VAT
 * is their difference, computed per rate by the door), lines carry their rate, and a note says this is a demo export.
 */
export function buildPeppolOrder(order: Order, ctx: PeppolContext): string {
  const delivery = order.deliveryDate ?? order.lines[0]?.deliveryDate;
  const note = 'Demo export from Lazydoor. Valio Aimo has no Peppol access point here, so this document was not sent to anyone; the endpoint ids are placeholders.';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:CustomizationID>${PEPPOL_CUSTOMIZATION_ID}</cbc:CustomizationID><cbc:ProfileID>${PEPPOL_PROFILE_ID}</cbc:ProfileID><cbc:ID>${escapeXml(order.id)}</cbc:ID><cbc:IssueDate>${escapeXml(ctx.decidedAt.slice(0, 10))}</cbc:IssueDate><cbc:Note>${escapeXml(note)}</cbc:Note><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
${party('BuyerCustomerParty', ctx.buyerId, ctx.buyerId)}
${party('SellerSupplierParty', 'VALIO-AIMO', 'Valio Aimo')}
${delivery ? `<cac:Delivery><cac:RequestedDeliveryPeriod><cbc:StartDate>${escapeXml(delivery)}</cbc:StartDate><cbc:EndDate>${escapeXml(delivery)}</cbc:EndDate></cac:RequestedDeliveryPeriod></cac:Delivery>` : ''}
<cac:TaxTotal>${money('TaxAmount', order.grossCents - order.netCents)}</cac:TaxTotal>
<cac:AnticipatedMonetaryTotal>${money('LineExtensionAmount', order.netCents)}${money('TaxExclusiveAmount', order.netCents)}${money('TaxInclusiveAmount', order.grossCents)}${money('PayableAmount', order.grossCents)}</cac:AnticipatedMonetaryTotal>
${order.lines.map((l, i) => orderLine(l, i + 1, ctx.products)).join('\n')}
</Order>
`;
}
