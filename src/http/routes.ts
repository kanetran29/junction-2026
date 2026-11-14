import { OpenAPIHono, createRoute, type z } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { listFamilies, resolve } from '../catalog/open';
import { searchProducts } from '../catalog/search';
import { getSetting, helsinkiIso, now, replayOn } from '../clock';
import type { Env } from '../env';
import { decisionRegister, reasonCodes } from '../domain/rules';
import { logEvent, verifyChain } from '../events/log';
import { InterpretError, confirmDraft, interpret } from '../interpret/gemini';
import { OrderError, createBasket, getOrder, placeOrder } from '../orders/store';
import { QuoteError, createQuote, getQuote, type QuoteInput } from '../quote/store';
import { productName } from '../receipt/render';
import { ValioRateLimited } from '../valio/client';
import { uiRoutes, receiptText } from '../ui/approve';
import { adminRoutes } from './admin';
import { HttpError, authenticate, rateLimit, requireBuyer } from './auth';
import { readEvents, streamEvents } from './events';
import * as S from './schemas';
import { storeKind } from '../db';
import { AUD, jwks, signJws } from '../sign/door';
import { tryDecision, tryIt } from '../try/sandbox';
import { VERSION, discovery } from './discovery';

export const INTERPRET_PER_MINUTE = 20;
/** `/v1/audit/verify` recomputes the whole chain, so anonymous callers get at most this many a minute per client address. */
export const AUDIT_PER_MINUTE = 30;

/** The only `/v1` routes that need no key: the published rules and reason codes, the audit check (it shows only hashes) and Try it (demo door only). */
const PUBLIC_PATHS = ['/v1/rules', '/v1/reason-codes', '/v1/audit/verify', '/v1/try', '/v1/try/decision'];

/** One documented JSON reply: its description and the zod schema of the body. */
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });

/** Every buyer route asks for the bearer API key. */
const SECURITY = [{ bearerAuth: [] }];

/** The documented replies of a buyer route: its 200 body plus the one shared `{ error, detail }` body for every failure status. */
const ok = <T extends z.ZodType>(schema: T) => ({
  200: json(schema, 'OK'),
  400: json(S.ErrorBody, 'Invalid request'),
  401: json(S.ErrorBody, 'Missing or unknown API key'),
  403: json(S.ErrorBody, 'The admin key has no buyer'),
  404: json(S.ErrorBody, 'Not found'),
  409: json(S.ErrorBody, 'Conflict'),
  422: json(S.ErrorBody, 'Unprocessable'),
  429: json(S.ErrorBody, 'Rate limited'),
  502: json(S.ErrorBody, 'Upstream failure'),
  503: json(S.ErrorBody, 'Model unavailable, or Valio rate-limited (VALIO_RATE_LIMITED, with a Retry-After header)'),
});

/** The required JSON request body of a route, as the zod schema describes it. */
const body = <T extends z.ZodType>(schema: T) => ({ body: { content: { 'application/json': { schema } }, required: true as const } });

const interpretRoute = createRoute({ method: 'post', path: '/v1/interpret', summary: 'Turn one sentence into a typed draft need (Gemini translates, Gemma re-reads independently; a different reading is needs_input; policy never reads it)', request: body(S.InterpretBody), security: SECURITY, responses: ok(S.InterpretReply) });
const confirmRoute = createRoute({ method: 'post', path: '/v1/drafts/{id}/confirm', summary: 'Fill what is unclear (and every field in missing after a disagreement) and confirm a draft', request: { params: S.IdParam, ...body(S.ConfirmBody) }, security: SECURITY, responses: ok(S.ConfirmReply) });
const searchRoute = createRoute({ method: 'post', path: '/v1/search', summary: 'Find products by category and claims, from the catalogue only (no Valio call)', request: body(S.SearchBody), security: SECURITY, responses: ok(S.SearchReply) });
const quoteRoute = createRoute({ method: 'post', path: '/v1/quotes', summary: 'Quote a need: ranked offers, rejections with reason codes, one Valio call per endpoint', request: body(S.QuoteBody), security: SECURITY, responses: ok(S.Quote) });
const getQuoteRoute = createRoute({ method: 'get', path: '/v1/quotes/{id}', summary: "Read the buyer's own quote", request: { params: S.IdParam }, security: SECURITY, responses: ok(S.Quote) });
const basketRoute = createRoute({ method: 'post', path: '/v1/baskets', summary: 'Quote several needs as one basket', request: body(S.BasketBody), security: SECURITY, responses: ok(S.BasketReply) });
const orderRoute = createRoute({
  method: 'post',
  path: '/v1/orders',
  summary: 'Place one offer or one offer per basket need; needs an Idempotency-Key',
  request: { headers: S.IdempotencyHeader, ...body(S.OrderBody) },
  security: SECURITY,
  responses: ok(S.Order),
});
const getOrderRoute = createRoute({ method: 'get', path: '/v1/orders/{id}', summary: "Read the buyer's own order", request: { params: S.IdParam }, security: SECURITY, responses: ok(S.Order) });
const receiptRoute = createRoute({ method: 'get', path: '/v1/orders/{id}/receipt', summary: "The order's plain-text receipt", request: { params: S.IdParam }, security: SECURITY, responses: ok(S.Receipt) });
const resolveRoute = createRoute({ method: 'post', path: '/v1/resolve', summary: 'Resolve a product id, sales-unit GTIN, brand or name from the catalogue; never corrects input, no Valio call', request: body(S.ResolveBody), security: SECURITY, responses: ok(S.ResolveReply) });
const familiesRoute = createRoute({ method: 'get', path: '/v1/families', summary: 'The catalogue map by category, or with terms the families that mention them, with evidence (no products, no Valio call)', request: { query: S.FamiliesQuery }, security: SECURITY, responses: ok(S.FamiliesReply) });
const rulesRoute = createRoute({ method: 'get', path: '/v1/rules', summary: 'The published decision register: who decides what, and the constants behind it', responses: { 200: json(S.RulesReply, 'OK') } });
const reasonCodesRoute = createRoute({ method: 'get', path: '/v1/reason-codes', summary: 'Every reason code with its text, resolution and whether a retry may help', responses: { 200: json(S.ReasonCodesReply, 'OK') } });
const eventsRoute = createRoute({ method: 'get', path: '/v1/events', summary: 'Events after `since` (exclusive), oldest first, at most 500; judge and admin keys read every buyer, an agent key only its own; on a demo door (`DEMO_MODE=1`) no key at all also reads every buyer, read-only (a wrong key is still 401)', request: { query: S.EventsQuery }, security: SECURITY, responses: { ...ok(S.EventsReply), 403: json(S.ErrorBody, "An agent key asked for another buyer's events") } });
const streamRoute = createRoute({
  method: 'get',
  path: '/v1/events/stream',
  summary: 'The same events as Server-Sent Events (`id`, `event`, `data`), `: ping` every 15 s, closed after about 60 s; resume with `since` or `Last-Event-ID`; same keys as `/v1/events`, keyless on a demo door (`DEMO_MODE=1`)',
  request: { query: S.EventsQuery },
  security: SECURITY,
  responses: { 200: { description: 'text/event-stream', content: { 'text/event-stream': { schema: S.EventStream } } }, 401: json(S.ErrorBody, 'Missing or unknown API key'), 403: json(S.ErrorBody, "Another buyer's events") },
});
const auditRoute = createRoute({ method: 'get', path: '/v1/audit/verify', summary: 'Recompute the hash chain of the whole event log and sign the result (head hash, first bad seq if any) with the door key; public, it shows only hashes; 30 a minute per client address', responses: { 200: json(S.AuditVerifyReply, 'OK'), 429: json(S.ErrorBody, 'Rate limited') } });
const tryRoute = createRoute({
  method: 'post',
  path: '/v1/try',
  summary: 'Demo door only, no key: order as the chef of your own sandbox kitchen (interpret, confirm, quote, place offer 0); a HELD order comes with its approval token, because you are its kitchen manager. The example sentences use recorded readings (no model call). 3 calls a minute per visitor, 60 per address, 6 free-text tries a minute for everyone',
  request: body(S.TryBody),
  responses: { 200: json(S.TryReply, 'OK'), 400: json(S.ErrorBody, 'Invalid request'), 404: json(S.ErrorBody, 'Not a demo door, Try it switched off, or an unknown visitor or draft'), 409: json(S.ErrorBody, 'The draft is already confirmed or still unclear'), 413: json(S.ErrorBody, 'Body over 4 KB'), 429: json(S.ErrorBody, 'TRY_RATE_LIMITED, with retryAfter'), 502: json(S.ErrorBody, 'Upstream failure'), 503: json(S.ErrorBody, 'MODELS_BUSY (Gemini over quota, with retryAfter; the example sentences still work), model unavailable, or Valio rate-limited') },
});
const tryDecisionRoute = createRoute({
  method: 'post',
  path: '/v1/try/decision',
  summary: "Demo door only: approve or reject a held order of your own sandbox through the normal approval path (re-check included); any other buyer's token is 404, an agent key 403",
  request: body(S.TryDecisionBody),
  responses: { 200: json(S.TryDecisionReply, 'OK'), 400: json(S.ErrorBody, 'Invalid request'), 403: json(S.ErrorBody, 'An agent or judge key'), 404: json(S.ErrorBody, 'Not a demo door, or an unknown visitor or token'), 409: json(S.ErrorBody, 'Already decided'), 429: json(S.ErrorBody, 'TRY_RATE_LIMITED') },
});
const healthRoute = createRoute({ method: 'get', path: '/health', summary: 'Liveness, the gateway clock, replay mode, whether a Gemini key is configured and the write store', responses: { 200: json(S.Health, 'OK') } });

/**
 * One demo page file from the static assets. A single `Range: bytes=a-b` (or `a-`, `-n`) on a whole-file reply is answered
 * with 206 and that slice, because the page's audio player seeks with it and the assets layer answers ranges with 200.
 */
async function demoFile(req: Request, assets: Fetcher): Promise<Response> {
  const res = await assets.fetch(req);
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('Range') ?? '');
  if (res.status !== 200 || !m || (!m[1] && !m[2])) return res;
  const body = new Uint8Array(await res.arrayBuffer());
  const size = body.byteLength;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  const headers = new Headers(res.headers);
  headers.delete('Content-Encoding');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}

/**
 * The whole gateway app: `/health`, the buyer routes under `/v1` as zod-openapi routes (documented at `/openapi.json`), the
 * demo-only admin routes, the approval pages and the demo page at `/demo/` (static assets). `fetchFn` reaches Valio and
 * Gemini and is injected by tests. Every failure leaves as `{ error, detail }`.
 */
export function createApp(fetchFn: typeof fetch = fetch): OpenAPIHono<{ Bindings: Env }> {
  const app = new OpenAPIHono<{ Bindings: Env }>({
    defaultHook: (result, c) => {
      if (!result.success) return c.json({ error: 'INVALID_REQUEST', detail: result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400);
    },
  });

  const eventsCors = cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'], allowHeaders: ['Authorization', 'Last-Event-ID'] });
  app.use('/v1/events', eventsCors);
  app.use('/v1/events/stream', eventsCors);
  /** Try it exists only on a demo door, and only while not switched off (`/admin/try`): else 404 before any validation. */
  const demoOnly: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
    if (c.env.DEMO_MODE !== '1' || (await getSetting(c.env, 'try_off')) === '1') throw new HttpError(404, 'NOT_FOUND', 'no such route');
    await next();
  };
  const tryCors = cors({ origin: '*', allowMethods: ['POST', 'OPTIONS'], allowHeaders: ['Content-Type'] });
  // a keyless route reads no body over 4 KB, so oversized bodies cost nothing before the rate limits apply
  const tryBodyLimit = bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'PAYLOAD_TOO_LARGE', detail: 'at most 4 KB' }, 413) });
  for (const path of ['/v1/try', '/v1/try/decision']) app.use(path, demoOnly, tryCors, tryBodyLimit);
  app.use('/v1/*', authenticate(PUBLIC_PATHS, ['/v1/events', '/v1/events/stream']));

  app.notFound((c) => c.json({ error: 'NOT_FOUND', detail: 'no such route' }, 404));

  app.get('/demo', (c) => c.redirect('/demo/', 301));
  app.get('/demo/*', (c) => demoFile(c.req.raw, c.env.ASSETS));

  app.onError((err, c) => {
    const known = errorBody(err);
    if (known?.retryAfter) c.header('Retry-After', String(known.retryAfter));
    if (known) return c.json({ error: known.code, detail: known.detail, ...(known.retryAfter ? { retryAfter: known.retryAfter } : {}) }, known.status);
    console.error(err);
    return c.json({ error: 'INTERNAL_ERROR', detail: 'unexpected failure' }, 500);
  });

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer', description: 'An API key from the gateway operator' });

  /** Liveness, the gateway clock, replay mode, whether a Gemini key is configured and which Postgres holds the writes. */
  app.openapi(healthRoute, async (c) =>
    c.json({ ok: true, now: helsinkiIso(await now(c.env)), replay: await replayOn(c.env), models: { gemini: Boolean(c.env.GEMINI_API_KEY) }, store: await storeKind(c.env) }, 200),
  );

  /** Interprets one sentence into a draft; rate limited per key, never touches Valio. */
  app.openapi(interpretRoute, async (c) => {
    const { buyerId } = await requireBuyer(c);
    await rateLimit(c.env, c.req.header('Authorization'), INTERPRET_PER_MINUTE);
    const draft = await interpret(c.env, { buyerId, text: c.req.valid('json').text }, { fetch: fetchFn });
    return c.json({ draft, valioCalls: 0 as const }, 200);
  });

  /** Applies the buyer's fill to the caller's own draft and confirms it. */
  app.openapi(confirmRoute, async (c) => {
    const { buyerId } = await requireBuyer(c);
    const draft = await confirmDraft(c.env, { draftId: c.req.valid('param').id, fill: c.req.valid('json').fill, buyerId });
    return c.json({ draft }, 200);
  });

  /** Catalogue search by category and claims, logged as `search.done`; zero Valio calls. */
  app.openapi(searchRoute, async (c) => {
    const { buyerId } = await requireBuyer(c);
    const q = c.req.valid('json');
    return c.json(await searchReply(c.env, buyerId, q), 200);
  });

  /** Quotes a stored draft, a posted draft or a product list for the caller. */
  app.openapi(quoteRoute, async (c) => {
    const { buyerId } = await requireBuyer(c);
    return c.json((await createQuote(c.env, buyerId, c.req.valid('json') as QuoteInput, fetchFn)) as never, 200);
  });

  /** Reads the caller's own quote; another buyer's is 404. */
  app.openapi(getQuoteRoute, async (c) => {
    const { buyerId } = await requireBuyer(c);
    const q = await getQuote(c.env, buyerId, c.req.valid('param').id);
    if (!q) throw new HttpError(404, 'QUOTE_NOT_FOUND', 'no such quote');
    return c.json(q as never, 200);
  });

  /** Quotes several needs as one basket for the caller. */
  app.openapi(basketRoute, async (c) => {
    const { buyerId } = await requireBuyer(c);
    return c.json((await createBasket(c.env, buyerId, c.req.valid('json').needs, fetchFn)) as never, 200);
  });

  /** Places one offer or a basket selection; identity and the Idempotency-Key come from the request, never from the body. */
  app.openapi(orderRoute, async (c) => {
    const { buyerId } = await requireBuyer(c);
    const reply = await placeOrder(c.env, { ...c.req.valid('json'), buyerId, idempotencyKey: c.req.header('Idempotency-Key') || undefined }, fetchFn);
    return c.json(reply as never, 200);
  });

  /** Reads the caller's own order; another buyer's is 404. */
  app.openapi(getOrderRoute, async (c) => {
    const { buyerId } = await requireBuyer(c);
    const o = await getOrder(c.env, buyerId, c.req.valid('param').id);
    if (!o) throw new HttpError(404, 'ORDER_NOT_FOUND', 'no such order');
    return c.json(o as never, 200);
  });

  /** The plain-text receipt of the caller's own order, with the signed receipt once the order is final. */
  app.openapi(receiptRoute, async (c) => {
    const { buyerId } = await requireBuyer(c);
    const id = c.req.valid('param').id;
    const text = await receiptText(c.env, id, buyerId);
    if (text === null) throw new HttpError(404, 'ORDER_NOT_FOUND', 'no such order');
    const jws = (await getOrder(c.env, buyerId, id))?.jws;
    return c.json({ text, ...(jws ? { jws } : {}) }, 200);
  });

  /** Resolves an id, GTIN, brand or name from the catalogue; never corrects input. */
  app.openapi(resolveRoute, async (c) => {
    await requireBuyer(c);
    return c.json((await resolve(c.env, c.req.valid('json'))) as never, 200);
  });

  /** The catalogue families, with evidence for the given terms. */
  app.openapi(familiesRoute, async (c) => {
    await requireBuyer(c);
    const terms = (c.req.valid('query').terms ?? '').split(',');
    return c.json({ families: await listFamilies(c.env, terms), valioCalls: 0 as const }, 200);
  });

  /** The public decision register. */
  app.openapi(rulesRoute, (c) => c.json({ decisions: decisionRegister(c.env.DEMO_MODE === '1') }, 200));
  /** The public reason-code table. */
  app.openapi(reasonCodesRoute, (c) => c.json({ codes: reasonCodes() }, 200));
  /** Polls the event log; the key decides which buyers are visible. */
  app.openapi(eventsRoute, async (c) => c.json(await readEvents(c), 200));
  /** Streams the event log as Server-Sent Events. */
  app.openapi(streamRoute, (c) => streamEvents(c) as never);
  /** One Try it step for a visitor (demo door only, no key); the client address comes from Cloudflare. */
  app.openapi(tryRoute, async (c) => c.json((await tryIt(c.env, c.req.valid('json'), c.req.header('CF-Connecting-IP') ?? 'unknown', fetchFn)) as never, 200));
  /** The visitor approves or rejects their own sandbox's held order. */
  app.openapi(tryDecisionRoute, async (c) =>
    c.json(await tryDecision(c.env, c.req.valid('json'), { address: c.req.header('CF-Connecting-IP') ?? 'unknown', authorization: c.req.header('Authorization') }, fetchFn), 200),
  );
  /** Recomputes the event chain and signs the result, stamped with the door clock; rate limited per client address. */
  app.openapi(auditRoute, async (c) => {
    await rateLimit(c.env, `Bearer audit:${c.req.header('CF-Connecting-IP') ?? 'unknown'}`, AUDIT_PER_MINUTE);
    const result = { ...(await verifyChain(c.env)), checkedAt: helsinkiIso(await now(c.env)) };
    return c.json({ ...result, jws: await signJws(c.env, { ...result, aud: AUD.audit }) }, 200);
  });
  /** The door's public signing key (JWK Set): verifies quote offers, receipts and audit results. */
  app.get('/.well-known/jwks.json', async (c) => c.json(await jwks(c.env), 200, { 'Cache-Control': 'public, max-age=300' }));

  /** What any agent fetches first: where the API, MCP, rules, events, audit, keys and demo are. */
  app.get('/.well-known/agent-gateway.json', (c) => c.json(discovery(new URL(c.req.url).origin, c.env.DEMO_MODE === '1')));

  app.doc('/openapi.json', (c) => {
    const discoveryUrl = `${new URL(c.req.url).origin}/.well-known/agent-gateway.json`;
    return {
      openapi: '3.0.3',
      info: { title: 'Lazydoor', version: VERSION, description: 'Lazy at the order, strict at the border. Discovery document (MCP, events, audit, signing keys, approval model): /.well-known/agent-gateway.json' },
      externalDocs: { url: discoveryUrl, description: 'Discovery document' },
    };
  });

  app.route('/', adminRoutes());
  app.route('/', uiRoutes(fetchFn));
  return app;
}

/** Catalogue search by category and claims for a buyer, logged as `search.done`; shared by the HTTP route and the MCP tool. */
export async function searchReply(env: Env, buyerId: string, q: { category: string; claims: string[]; subtype?: string }): Promise<{ products: z.infer<typeof S.SearchProduct>[]; valioCalls: 0 }> {
  const found = await searchProducts(env, { category: q.category, claims: q.claims, subtype: q.subtype });
  await logEvent(env, { buyerId, type: 'search.done', data: { count: found.length, categories: [...new Set(found.map((p) => p.category))] } });
  const products = found.map((p) => ({ id: p.id, category: p.category, subtype: p.subtype, name: productName([p], p.id), brand: p.brand, salesUnit: p.salesUnit, claims: p.claims }));
  return { products, valioCalls: 0 };
}

/** Maps a thrown error from any module onto an HTTP status, machine-readable code and message (plus the wait in seconds for a Valio rate limit); null for a bug. */
export function errorBody(err: unknown): { status: 400 | 401 | 403 | 404 | 409 | 415 | 422 | 429 | 502 | 503; code: string; detail: string; retryAfter?: number } | null {
  if (err instanceof ValioRateLimited) return { status: 503, code: 'VALIO_RATE_LIMITED', detail: err.message, retryAfter: err.retryAfter };
  if ((err instanceof HttpError || err instanceof InterpretError) && err.retryAfter) return { status: err.status, code: err.code, detail: err.message, retryAfter: err.retryAfter };
  if (err instanceof HttpError || err instanceof OrderError || err instanceof InterpretError) return { status: err.status, code: err.code, detail: err.message };
  if (err instanceof QuoteError) {
    const status = err.code === 'DRAFT_NOT_FOUND' ? 404 : err.code === 'UPSTREAM_ERROR' ? 502 : 409;
    return { status, code: err.code, detail: err.message };
  }
  if (err instanceof HTTPException) return { status: err.status as 400 | 415, code: 'INVALID_REQUEST', detail: err.message };
  if (err instanceof ZodError) return { status: 400, code: 'INVALID_REQUEST', detail: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') };
  return null;
}
