import { QUOTE_TTL_MS } from '../quote/build';
import { REJECTION_PRECEDENCE, defaultMandate } from './constants';
import { REASONS } from './reasons';

export interface Decision {
  id: string;
  rule: string;
  owner: string;
  model: boolean;
  constants: Record<string, unknown>;
}

const seller = (id: string, rule: string, constants: Record<string, unknown> = {}): Decision => ({ id, rule, owner: 'seller', model: false, constants });

/**
 * The published decision register: who decides each step of an order, whether a model is involved, and the constants
 * that govern it. Built from the code's own constants so the register cannot drift from what the door does.
 */
export function decisionRegister(): Decision[] {
  const mandate = defaultMandate('buyer');
  return [
    seller('orderable', 'A product is orderable only with a valid price, stock for the delivery date, no sales block and the cut-off not passed.'),
    seller('conversion', 'The requested quantity becomes whole sales units from the product content and lot step; a quantity that does not divide is rejected, never rounded silently.'),
    seller('rounding', 'Money is integer cents; products of price and units round half up.', { mode: 'half-up', unit: 'cent' }),
    seller('subtype', 'A product matches the need only inside the reviewed or tagged subtype of the requested category.'),
    seller('ranking', 'Offers rank by net total, ascending. No sponsored placement, no popularity score.', { rankedBy: ['netTotal'], sponsored: false, popularity: false }),
    seller('rejectionPrecedence', 'The first failing check in this order is the single rejection code of a candidate.', { order: [...REJECTION_PRECEDENCE] }),
    seller('split', 'An order may be split across products only to cover the quantity from stock, cheapest first.'),
    seller('substitution', 'A substitute must keep the subtype, claims and allergen profile; any change is declared as a change code.'),
    seller('quoteExpiry', 'A quote is binding until it expires or the earliest Valio cut-off, whichever is first.', { ttlMinutes: QUOTE_TTL_MS / 60_000 }),
    seller('allocation', 'Stock is allocated first come, first served at acceptance; a later order that finds it taken is refused with STOCK_TAKEN.'),
    seller('approvalRecheck', 'An approved held order is re-checked against live price and stock before it is accepted.'),
    { id: 'interpretation', rule: 'A model turns free text into a typed draft; policy and money never read the model output directly.', owner: 'buyer', model: true, constants: {} },
    {
      id: 'policy',
      rule: "The buyer's signed mandate decides AUTO, NEEDS_APPROVAL or REJECT; no model is involved.",
      owner: 'buyer',
      model: false,
      constants: { perOrder: mandate.perOrder, perDay: mandate.perDay, reliabilityFloor: mandate.reliabilityFloor, reliabilityUnknown: mandate.reliabilityUnknown, noNewAllergen: mandate.noNewAllergen },
    },
    { id: 'approval', rule: 'A held order is accepted only when the named human approver approves it through their own link.', owner: 'approver', model: false, constants: {} },
  ];
}

/** Every reason code with its text, who can resolve it and whether a retry may succeed. */
export const reasonCodes = () => Object.entries(REASONS).map(([code, info]) => ({ code, ...info }));
