import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ErrorCode, McpError, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { listFamilies, resolve } from '../catalog/open';
import type { Env } from '../env';
import { confirmDraft, interpret } from '../interpret/gemini';
import { cancelOrder, createBasket, getOrder, placeOrder } from '../orders/store';
import { createQuote, type QuoteInput } from '../quote/store';
import { SANDBOX_BUYER_PREFIX } from '../domain/constants';
import { HttpError, countUse, identify, keyIdOf, rateLimit } from '../http/auth';
import { CONNECTOR_ALL_PER_MINUTE, MCP_PER_TOKEN_PER_MINUTE, challenge, connectorOn, oauthCaller } from '../oauth/server';
import { limit, limitFreeText } from '../try/sandbox';
import { INTERPRET_PER_MINUTE, errorBody, searchReply } from '../http/routes';
import * as S from '../http/schemas';

/** One MCP tool: its schemas (the HTTP ones) and the service call behind it. */
interface Tool {
  name: string;
  description: string;
  input: z.ZodType;
  output: z.ZodType;
  run: (a: any, who: { env: Env; buyerId: string; auth: string | undefined; fetchFn: typeof fetch }) => Promise<unknown>;
  failed?: (reply: any) => boolean;
}

const PlaceOrderInput = z.intersection(S.OrderBody, z.object({ idempotencyKey: S.IdempotencyHeader.shape["Idempotency-Key"].unwrap().describe('Unique per order attempt; a retry with the same key and body returns the same order') }));

const tools: Tool[] = [
  {
    name: 'interpret_request',
    description: 'Turn one sentence into a typed draft need (Gemini translates, Gemma re-reads independently; if they differ the draft is needs_input with a disagreement list for the buyer; policy never reads it).',
    input: S.InterpretBody,
    output: S.InterpretReply,
    run: async (a, { env, buyerId, auth, fetchFn }) => {
      await rateLimit(env, auth, INTERPRET_PER_MINUTE);
      if (buyerId.startsWith(SANDBOX_BUYER_PREFIX)) await limitFreeText(env);
      return { draft: await interpret(env, { buyerId, text: a.text }, { fetch: fetchFn }), valioCalls: 0 };
    },
  },
  {
    name: 'confirm_draft',
    description: 'Fill what is unclear (and, for a disagreement, every field in missing) and confirm a draft.',
    input: S.IdParam.extend({ fill: S.ConfirmBody.shape.fill }),
    output: S.ConfirmReply,
    run: async (a, { env, buyerId }) => ({ draft: await confirmDraft(env, { draftId: a.id, fill: a.fill, buyerId }) }),
  },
  {
    name: 'search_products',
    description: 'Find products by category and claims, from the catalogue only (no Valio call).',
    input: S.SearchBody,
    output: S.SearchReply,
    run: (a, { env, buyerId }) => searchReply(env, buyerId, a),
  },
  {
    name: 'get_quote',
    description: "Quote a need (a stored draftId, a draft, or a bare need): ranked offers, rejections with reason codes, one Valio call per endpoint. Every offer carries the door's signed jws (verify with /.well-known/jwks.json).",
    input: S.QuoteBody,
    output: S.Quote,
    run: (a, { env, buyerId, fetchFn }) => createQuote(env, buyerId, a as QuoteInput, fetchFn),
  },
  {
    name: 'quote_basket',
    description: 'Quote several needs as one basket.',
    input: S.BasketBody,
    output: S.BasketReply,
    run: (a, { env, buyerId, fetchFn }) => createBasket(env, buyerId, a.needs, fetchFn),
  },
  {
    name: 'place_order',
    description: "Place one offer, or one offer per basket need; needs an idempotencyKey. Send the offer's jws as quoteJws to have the door check it (a mismatch is QUOTE_SIGNATURE_INVALID). A final order carries a signed jws receipt. A REJECTED order is returned with isError.",
    input: PlaceOrderInput,
    output: S.Order,
    run: (a, { env, buyerId, fetchFn }) => placeOrder(env, { ...a, buyerId }, fetchFn),
    failed: (reply) => reply.state === 'REJECTED',
  },
  {
    name: 'get_order',
    description: "Read the buyer's own order.",
    input: S.IdParam,
    output: S.Order,
    run: async (a, { env, buyerId }) => (await getOrder(env, buyerId, a.id)) ?? Promise.reject(new HttpError(404, 'ORDER_NOT_FOUND', 'no such order')),
  },
  {
    name: 'cancel_order',
    description: "Cancel the buyer's own ACCEPTED or HELD order before Valio's cut-off: the stock goes back on sale, the day total no longer counts it, and the reply is the door's signed cancellation record (jws, aud lazydoor:cancellation; verify with /.well-known/jwks.json). Idempotent; after the cut-off it is ORDER_CUTOFF_PASSED.",
    input: S.IdParam.extend({ reason: S.CancelBody.shape.reason }),
    output: S.Cancellation,
    run: async (a, { env, buyerId, auth }) =>
      cancelOrder(env, { buyerId, orderId: a.id, reason: a.reason, by: { role: buyerId.startsWith(SANDBOX_BUYER_PREFIX) ? 'connector' : 'agent', keyId: await keyIdOf(auth) } }),
  },
  {
    name: 'resolve_product',
    description: 'Resolve a product id, sales-unit GTIN, brand or name from the catalogue; never corrects input, no Valio call.',
    input: S.ResolveBody,
    output: S.ResolveReply,
    run: (a, { env }) => resolve(env, a),
  },
  {
    name: 'list_families',
    description: 'The catalogue map by category, or with comma-separated terms the families that mention them, with evidence (no products, no Valio call).',
    input: S.FamiliesQuery,
    output: S.FamiliesReply,
    run: async (a, { env }) => ({ families: await listFamilies(env, (a.terms ?? '').split(',')), valioCalls: 0 }),
  },
];

/** The JSON Schema MCP clients see; MCP requires `type: "object"` at the top, which a union schema lacks. */
const jsonSchema = (s: z.ZodType) => ({ type: 'object' as const, ...z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }) });

/** The tools/list payload; exported so tests can compare it with the HTTP schemas. */
export const toolDefinitions = tools.map((t) => ({ name: t.name, description: t.description, inputSchema: jsonSchema(t.input), outputSchema: { type: 'object' as const, ...z.toJSONSchema(t.output, { io: 'output', unrepresentable: 'any' }) } }));

/** Wraps a reply as the MCP tool result: JSON in `structuredContent` and as text. */
const result = (body: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(body) }], structuredContent: body as Record<string, unknown>, isError: false });

/** A refusal: the JSON as text only, because it does not match the tool's `outputSchema` and clients validate `structuredContent` against it. */
const refusal = (error: string, detail: string, retryAfter?: number) => ({ content: [{ type: 'text' as const, text: JSON.stringify({ error, detail, ...(retryAfter ? { retryAfter } : {}) }) }], isError: true });

/**
 * Serves one stateless MCP request for an authenticated buyer: a fresh server and transport per call, tools run the same
 * service functions as the HTTP routes, and every typed failure becomes `{ error, detail }` with `isError` set.
 */
export async function handleMcp(req: Request, who: { env: Env; buyerId: string; fetchFn: typeof fetch }): Promise<Response> {
  const server = new Server({ name: 'lazydoor', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const tool = tools.find((t) => t.name === params.name);
    if (!tool) throw new McpError(ErrorCode.InvalidParams, `unknown tool ${params.name}`);
    const parsed = tool.input.safeParse(params.arguments ?? {});
    if (!parsed.success) return refusal('INVALID_REQUEST', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
    try {
      const reply = await tool.run(parsed.data, { ...who, auth: req.headers.get('Authorization') ?? undefined });
      return tool.failed?.(reply) ? { ...result(reply), isError: true } : result(reply);
    } catch (err) {
      const known = errorBody(err);
      if (known) return refusal(known.code, known.detail, known.retryAfter);
      console.error(err);
      return refusal('INTERNAL_ERROR', 'unexpected failure');
    }
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

/**
 * The `/mcp` route (POST only; stateless, so no event stream), answered by `handleMcp`: the same bearer API key as `/v1`, or
 * (demo door, feature `connector`) a connector access token, which acts for its own sandbox kitchen only, at most 60 calls a minute
 * per token and 240 a minute over all of them.
 * With the connector on, a missing or dead token is 401 with a WWW-Authenticate challenge pointing to the OAuth metadata.
 */
export function mcpRoutes(fetchFn: typeof fetch = fetch): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.post('/mcp', async (c) => {
    const header = c.req.header('Authorization');
    const key = await identify(c.env, header);
    if (key?.buyerId) return handleMcp(c.req.raw, { env: c.env, buyerId: key.buyerId, fetchFn });
    if (key) throw new HttpError(403, 'FORBIDDEN', 'the admin key has no buyer; use an agent or judge key');
    const connector = await connectorOn(c.env);
    const oauth = connector ? await oauthCaller(c.env, header) : null;
    if (oauth) {
      if ((await countUse(c.env, `oauth-mcp:${oauth.tokenHash}`)) > MCP_PER_TOKEN_PER_MINUTE) throw new HttpError(429, 'RATE_LIMITED', `at most ${MCP_PER_TOKEN_PER_MINUTE} MCP calls a minute for this token`);
      await limit(c.env, 'connector-all', CONNECTOR_ALL_PER_MINUTE, `the connector is busy: at most ${CONNECTOR_ALL_PER_MINUTE} MCP calls a minute over every connector token`);
      return handleMcp(c.req.raw, { env: c.env, buyerId: oauth.buyerId, fetchFn });
    }
    const detail = { error: 'UNAUTHORIZED', detail: 'a valid Bearer API key is required' };
    if (connector) return c.json(detail, 401, { 'WWW-Authenticate': challenge(new URL(c.req.url).origin, header !== undefined) });
    return c.json(detail, 401);
  });
  app.all('/mcp', (c) => c.json({ error: 'METHOD_NOT_ALLOWED', detail: 'POST JSON-RPC to /mcp' }, 405, { Allow: 'POST' }));
  return app;
}
