import { QUOTE_TTL_MS, RANKED_BY } from '../quote/build';
import { REJECTION_PRECEDENCE, defaultMandate } from './constants';
import { REASONS } from './reasons';
import { AUD } from '../sign/door';
import { MAX_SANDBOXES, SANDBOXES_PER_ADDRESS, SANDBOX_IDLE_MS, TRY_AGENT_REASON, TRY_ALL_PER_MINUTE, TRY_APPROVER, TRY_FREE_TEXT_PER_MINUTE, TRY_PER_ADDRESS_PER_MINUTE, TRY_PER_VISITOR_PER_MINUTE } from '../try/sandbox';
import { TRANSCRIPT_MAX, VOICE_MAX_BYTES } from '../try/voice';

export interface Decision {
  id: string;
  rule: string;
  owner: string;
  model: boolean;
  constants: Record<string, unknown>;
}

/** One decision-register entry owned by the seller (the gateway), with no model involved. */
const seller = (id: string, rule: string, constants: Record<string, unknown> = {}): Decision => ({ id, rule, owner: 'seller', model: false, constants });

/**
 * The published decision register: who decides each step of an order, whether a model is involved, and the constants
 * that govern it. Built from the code's own constants so the register cannot drift from what the door does. Try it is
 * listed only on a demo door (`demo`), the only place it exists.
 */
export function decisionRegister(demo = true): Decision[] {
  const mandate = defaultMandate('buyer');
  return [
    seller('orderable', 'A product is orderable only with a valid price, stock for the delivery date, no sales block and the cut-off not passed. Valio availability of 999999 or more means the stock is unknown, not unlimited: any quantity is allowed and the quote line says so.'),
    seller('conversion', 'The requested quantity becomes whole sales units from the product content and lot step, rounded up; the offer shows the overage. Only a quantity that cannot be converted (unit mismatch, no usable content) is rejected.'),
    seller('rounding', 'Money is integer cents; products of price and units round half up.', { mode: 'half-up', unit: 'cent' }),
    seller('subtype', 'A product matches the need only inside the reviewed or tagged subtype of the requested category.'),
    seller('ranking', 'Offers that cover the quantity rank before partial ones, a preferred brand before others, then by net total, unit price and reliability. No sponsored placement, no popularity score.', { rankedBy: RANKED_BY, sponsored: false, popularity: false }),
    seller('rejectionPrecedence', 'The first failing check in this order is the single rejection code of a candidate.', { order: [...REJECTION_PRECEDENCE] }),
    seller('split', 'An order may be split across products only to cover the quantity from stock: the reference product first, then the others cheapest per litre or kilo first.'),
    seller('substitution', 'A substitute must keep the subtype, claims and allergen profile; any change is declared as a change code.'),
    seller('quoteExpiry', 'A quote is binding until the earliest of its time limit, the Valio cut-off of its products and the end of their price validity.', { ttlMinutes: QUOTE_TTL_MS / 60_000 }),
    seller('allocation', 'Stock is allocated first come, first served at acceptance; a later order that finds it taken is refused with STOCK_TAKEN.'),
    seller('approvalRecheck', 'An approved held order is re-checked against live price and stock before it is accepted.'),
    { id: 'interpretation', rule: 'Gemini turns free text into a typed draft and Gemma reads the same text independently; when the two readings differ on any field the draft is needs_input and the buyer fills that field. Policy and money never read model output directly.', owner: 'buyer', model: true, constants: {} },
    {
      id: 'policy',
      rule: "The buyer's signed mandate decides AUTO, NEEDS_APPROVAL or REJECT; no model is involved.",
      owner: 'buyer',
      model: false,
      constants: { perOrder: mandate.perOrder, perDay: mandate.perDay, reliabilityFloor: mandate.reliabilityFloor, reliabilityUnknown: mandate.reliabilityUnknown, noNewAllergen: mandate.noNewAllergen },
    },
    { id: 'approval', rule: "A held order is accepted only when the named human approver approves it through their own link; agent and judge keys never can. (In Try it, a visitor is the approver of their own sandbox kitchen only.)", owner: 'approver', model: false, constants: {} },
    seller('signatures', "The door signs every quote offer and every final order (accepted, rejected or expired) with its Ed25519 key, published at /.well-known/jwks.json. An order may send the offer's JWS back as quoteJws; it is placed only when the signature verifies and every bound field equals the offer as quoted, otherwise it is refused with QUOTE_SIGNATURE_INVALID.", { alg: 'EdDSA', audiences: AUD }),
    ...(demo ? [seller(
      'tryIt',
      'Demo door only: a visitor orders as the chef of a sandbox kitchen with no key. The door interprets the text (Gemini, read again by Gemma), fills only the reference agent\'s profile default, asks the visitor about any open field, then quotes and places the cheapest covering offer exactly as an agent would; the sandbox mandate decides, and a held order is approved or rejected by the visitor as that kitchen\'s manager through the normal approval path. A sandbox never sees or decides another buyer\'s orders and orders from its own stock world, so it never takes the stock real buyers are checked against; the page\'s example sentences use recorded Gemini and Gemma readings (marked cached) so they need no model call; a sandbox idle for 20 minutes is removed with its orders, past 500 the least recently used is recycled, and all end at a demo reset.',
      { perVisitorPerMinute: TRY_PER_VISITOR_PER_MINUTE, perAddressPerMinute: TRY_PER_ADDRESS_PER_MINUTE, freeTextPerMinute: TRY_FREE_TEXT_PER_MINUTE, allCallsPerMinute: TRY_ALL_PER_MINUTE, maxSandboxes: MAX_SANDBOXES, sandboxesPerAddress: SANDBOXES_PER_ADDRESS, voiceMaxBytes: VOICE_MAX_BYTES, transcriptMaxChars: TRANSCRIPT_MAX, idleMinutes: SANDBOX_IDLE_MS / 60_000, recordedExamples: true, approver: TRY_APPROVER, agentReason: TRY_AGENT_REASON, mandate: { perOrderAutoEur: 500, perDayAutoEur: 1500, perOrderHardEur: 5000, perDayHardEur: 10000 } },
    )] : []),
    seller(
      'peppolExport',
      "Feature `peppol` (off by default): an ACCEPTED order can be downloaded as a Peppol BIS Order 3.0 (UBL 2.1, \"Order only\") XML at GET /v1/orders/{id}/peppol (buyer key, or a Try it visitor's X-Visitor-Token for their own sandbox) and GET /approve/{token}/peppol (the approver). Export only: Valio Aimo has no Peppol access point here, nothing is sent, and the endpoint ids are placeholders. Totals and VAT are the order's own; any other state is 409 ORDER_NOT_ACCEPTED.",
      { customizationId: 'urn:fdc:peppol.eu:poacc:trns:order:3', profileId: 'urn:fdc:peppol.eu:poacc:bis:ordering:3', sent: false },
    ),
    seller('auditChain', 'Every event is hash-chained in commit order: hash = sha256(prevHash + canonical JSON of the event), starting from 64 zeros after a reset. /v1/audit/verify recomputes the whole chain and signs the result.', { hash: 'sha256', canonicalJson: 'RFC 8785 (JCS)', genesis: '0'.repeat(64) }),
  ];
}

/** Every reason code with its text, who can resolve it and whether a retry may succeed. */
export const reasonCodes = () => Object.entries(REASONS).map(([code, info]) => ({ code, ...info }));
