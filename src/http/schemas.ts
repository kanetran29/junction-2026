import { z } from '@hono/zod-openapi';
import { draftSchema } from '../quote/store';

/** The `{ error, detail }` body every failed request answers with. */
export const ErrorBody = z.object({ error: z.string(), detail: z.string() }).openapi('Error');

/** The typed need (category, reference product or product list) shared by quotes, baskets and the MCP tools. */
export const Draft = draftSchema.openapi('Need');

/** A draft as `interpret` and `confirm` return it: typed fields plus what is still unclear or missing. */
export const InterpretedDraft = z.looseObject({ id: z.string(), status: z.enum(['draft', 'needs_input', 'confirmed']), text: z.string(), claims: z.array(z.string()), unclear: z.array(z.string()), missing: z.array(z.string()), needs: z.array(z.string()) }).openapi('Draft');

export const InterpretBody = z.object({ text: z.string().min(1) }).openapi('InterpretRequest');
export const InterpretReply = z.object({ draft: InterpretedDraft, valioCalls: z.literal(0) }).openapi('InterpretReply');

export const ConfirmBody = z.object({ fill: z.record(z.string(), z.unknown()) }).openapi('ConfirmRequest');
export const ConfirmReply = z.object({ draft: InterpretedDraft }).openapi('ConfirmReply');

export const SearchBody = z.object({ category: z.string().min(1), claims: z.array(z.string().min(1)).default([]), subtype: z.string().min(1).optional() }).openapi('SearchRequest');
export const SearchProduct = z.looseObject({ id: z.string(), category: z.string(), subtype: z.string().nullable(), name: z.string().nullable(), brand: z.string().nullable(), salesUnit: z.string().nullable(), claims: z.array(z.string()) }).openapi('SearchProduct');
export const SearchReply = z.object({ products: z.array(SearchProduct), valioCalls: z.literal(0) }).openapi('SearchReply');

/** A quote request names a stored draft, a draft to confirm and use, or a bare need. */
export const QuoteBody = z.union([z.object({ draftId: z.string().min(1) }), z.object({ draft: Draft }), Draft]).openapi('QuoteRequest');
export const Quote = z.looseObject({ id: z.string(), buyerId: z.string(), expiresAt: z.string(), offers: z.array(z.looseObject({ offerId: z.string(), netCents: z.number() })), rejections: z.array(z.looseObject({ productId: z.string(), code: z.string() })) }).openapi('Quote');

export const BasketBody = z.object({ needs: z.array(Draft).min(1) }).openapi('BasketRequest');
export const BasketReply = z.object({ basketId: z.string(), quotes: z.array(Quote), expiresAt: z.string() }).openapi('BasketReply');

/** One offer of one quote; a basket order lists one per need. */
const Selection = z.object({ quoteId: z.string().min(1), offerId: z.string().min(1) });
export const OrderBody = z.union([
  z.object({ quoteId: z.string().min(1), offerId: z.string().min(1), agentReason: z.string().optional() }),
  z.object({ basketId: z.string().min(1), selections: z.array(Selection).min(1), agentReason: z.string().optional() }),
]).openapi('OrderRequest');
export const Order = z.looseObject({
  orderId: z.string(),
  state: z.enum(['ACCEPTED', 'HELD', 'REJECTED', 'EXPIRED']),
  reason: z.string().optional(),
  decision: z.looseObject({ outcome: z.string(), reasons: z.array(z.looseObject({ code: z.string() })) }),
  approval: z.object({ status: z.enum(['pending', 'none']), approver: z.string() }),
  order: z.looseObject({ id: z.string(), netCents: z.number(), grossCents: z.number() }),
  available: z.number().optional(),
  retryable: z.boolean().optional(),
  resolution: z.string().optional(),
}).openapi('Order');

export const Receipt = z.object({ text: z.string() }).openapi('Receipt');
export const Health = z.object({ ok: z.boolean(), now: z.string(), replay: z.boolean(), models: z.object({ gemini: z.boolean() }) }).openapi('Health');

export const IdParam = z.object({ id: z.string().min(1) });

/** `POST /v1/orders` header; the handler reads it directly and the order layer answers 400 when it is missing. */
export const IdempotencyHeader = z.object({ 'Idempotency-Key': z.string().optional().openapi({ description: 'Unique per order attempt; a retry with the same key and body returns the same order' }) });
