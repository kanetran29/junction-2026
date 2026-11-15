import { readFileSync } from 'node:fs';
import { randomUUID, webcrypto } from 'node:crypto';
import { join } from 'node:path';
import { match } from './matcher';

type Json = any;
type Step = { call: string; input: Json; expect: [string, string, unknown][]; as?: string; given?: Json; repeat?: number };
type Case = { id: string; title: string; given?: Json; steps: Step[] };
type Req = { method?: string; key?: string; body?: Json; headers?: Record<string, string> };

/** Per-case mutable state: keys minted by reset, plus what each buyer last quoted, ordered and approved. */
type Ctx = {
  agentKeys: Record<string, string>;
  approverKeys: Record<string, string>;
  given: Json;
  defaultBuyer: string;
  draftId?: string;
  lastQuote: Record<string, Json>;
  lastOrderId: Record<string, string>;
  basket: Record<string, Json>;
  tokens: Record<string, string>;
  mcpSession?: string;
  /** The reset body this case started from, for a step that resets again. */
  resetBody: Json;
  /** Try it: the last reply of this case's visitor, and of a second visitor. */
  tryReply?: Json;
  otherTry?: Json;
  /** The connector: its access token, the person's kitchen link, the order placed over /mcp and its approval path. */
  oauthToken?: string;
  kitchen?: string;
  connectorOrder?: string;
  connectorApproval?: string;
};
type Handler = (ctx: Ctx, step: Step, buyer: string, given: Json) => Promise<Json>;

const GATEWAY = (process.env.GATEWAY_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const ADMIN_KEY = process.env.ADMIN_KEY ?? 'dev-admin-key';
const DIR = process.env.ACCEPTANCE_DIR ?? 'research/acceptance';
/** Authorization header for a key, or nothing when there is no key. */
const bearer = (key?: string): Record<string, string> => (key ? { Authorization: `Bearer ${key}` } : {});

/**
 * Sends one HTTP request to the gateway and returns the parsed JSON reply with `httpStatus` added;
 * a non-JSON or non-object body becomes `{ text }` so every expectation path can still be read.
 */
async function http(path: string, { method, key, body, headers }: Req = {}): Promise<Json> {
  const res = await fetch(GATEWAY + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...bearer(key), ...headers } as Record<string, string>,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed: Json;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { text: raw };
  }
  const obj = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { value: parsed };
  return { ...obj, httpStatus: res.status };
}

/** Calls the gateway with the admin key (GET, or POST when a body is given). */
const admin = (path: string, body?: Json) => http(path, { key: ADMIN_KEY, body });

/** Calls the gateway as a buyer's agent (GET, or POST when a body is given). */
const agent = (ctx: Ctx, buyer: string, path: string, body?: Json, headers?: Record<string, string>) =>
  http(path, { key: ctx.agentKeys[buyer], body, headers });

/** Quotes the step's draft for a buyer and remembers the quote as the buyer's latest. */
async function quote(ctx: Ctx, step: Step, buyer: string, given: Json): Promise<Json> {
  const input = step.input ?? {};
  let body: Json;
  if (Object.keys(input).length) body = input;
  else if (given.draft) body = { draft: given.draft };
  else body = { draftId: ctx.draftId };
  const reply = await agent(ctx, buyer, '/v1/quotes', body);
  ctx.lastQuote[buyer] = reply;
  return reply;
}

/**
 * Places one offer of a buyer's latest quote with an Idempotency-Key (fresh unless given or `key === null`
 * for none) and remembers the order id.
 */
async function place(ctx: Ctx, buyer: string, offer: number, o: { agentReason?: string; key?: string | null } = {}): Promise<Json> {
  const q = ctx.lastQuote[buyer];
  const headers: Record<string, string> = {};
  if (o.key !== null) headers['Idempotency-Key'] = o.key ?? randomUUID();
  const reply = await agent(ctx, buyer, '/v1/orders', { quoteId: q?.id, offerId: q?.offers?.[offer]?.offerId, agentReason: o.agentReason }, headers);
  await remember(ctx, buyer, reply);
  return reply;
}

/**
 * Records a place reply's order id and, when the order is HELD, reads its approval token from the approver
 * inbox right away (the inbox lists HELD orders regardless of cut-off), so a later clock change cannot hide it.
 */
async function remember(ctx: Ctx, buyer: string, reply: Json): Promise<void> {
  if (!reply.orderId) return;
  ctx.lastOrderId[buyer] = reply.orderId;
  if (reply.state === 'HELD') await fetchToken(ctx, buyer, reply.orderId);
}

/** Reads the approver inbox of a buyer and caches the token of `orderId` if listed. */
async function fetchToken(ctx: Ctx, buyer: string, orderId: string): Promise<void> {
  const inbox = await http(`/approver/${ctx.approverKeys[buyer]}`, { headers: { Accept: 'application/json' } });
  const hit = (inbox.pending ?? []).find((p: Json) => p.orderId === orderId);
  if (hit) ctx.tokens[orderId] = hit.token;
}

/**
 * Verifies a compact EdDSA JWS from the door with only its published JWKS (as any client would) and returns its claims, or
 * null when the key, algorithm or signature does not check out.
 */
async function verifyDoorJws(jws: string | undefined): Promise<Json | null> {
  if (typeof jws !== 'string') return null;
  const [h, p, s] = jws.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  const jwk = (await http('/.well-known/jwks.json')).keys?.find((k: Json) => k.kid === header.kid);
  if (header.alg !== 'EdDSA' || !jwk) return null;
  const key = await webcrypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, { name: 'Ed25519' }, false, ['verify']);
  return (await webcrypto.subtle.verify('Ed25519', key, Buffer.from(s, 'base64url'), Buffer.from(`${h}.${p}`))) ? JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) : null;
}

/** A copy of a JWS whose claims were edited (`field`, the net by default, halved), keeping the door's header and signature. */
function tamperedPrice(jws: string, field = 'netCents'): string {
  const [h, p, s] = jws.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  claims[field] = Math.floor(claims[field] / 2);
  return `${h}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${s}`;
}

/** The door's audit check plus whether its signed head verifies with the JWKS and says exactly what the reply says. */
async function auditVerify(): Promise<Json> {
  const { jws, httpStatus, ...result } = await http('/v1/audit/verify');
  const claims = await verifyDoorJws(jws);
  const same = claims !== null && JSON.stringify(Object.keys(claims).filter((k) => k !== 'aud').sort().map((k) => [k, claims[k]])) === JSON.stringify(Object.keys(result).sort().map((k) => [k, result[k]]));
  return { ...result, httpStatus, signatureVerified: same && claims.aud === 'lazydoor:audit' };
}

/** Counts rows of an admin list endpoint (`{ count }`). */
const adminCount = async (path: string) => (await admin(path)).count;

/**
 * Finds the approval token of a buyer's latest order in the approver inbox (cached so a second `approve`
 * reuses it, normally captured when the order was placed) and posts the approval, with the agent key when `asAgent` (which must be refused).
 */
async function approve(ctx: Ctx, buyer: string, asAgent: boolean): Promise<Json> {
  const orderId = ctx.lastOrderId[buyer];
  if (!ctx.tokens[orderId]) await fetchToken(ctx, buyer, orderId);
  if (!ctx.tokens[orderId]) throw new Error(`no pending approval for order ${orderId} in the approver inbox`);
  return http(`/approve/${ctx.tokens[orderId]}`, { method: 'POST', key: asAgent ? ctx.agentKeys[buyer] : undefined });
}

/** Decodes a JSON-RPC reply that arrives either as plain JSON or as an SSE `data:` stream. */
function rpcResult(text: string): Json {
  const data = text.trimStart().startsWith('{') ? text : text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('');
  return JSON.parse(data).result;
}

/** Unpadded base64url of bytes (the PKCE verifier and challenge). */
const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');

/**
 * The connector's OAuth flow as Claude runs it: register a client, open the consent page with PKCE S256, allow it as the
 * person (cookie and form CSRF), exchange the code. Keeps the access token and the kitchen link; returns statuses only.
 */
async function connectorConnect(ctx: Ctx): Promise<Json> {
  const redirect = 'https://claude.ai/api/mcp/auth_callback';
  const reg = await http('/oauth/register', { body: { client_name: 'Acceptance (as Claude)', redirect_uris: [redirect] } });
  const verifier = b64u(webcrypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64u(new Uint8Array(await webcrypto.subtle.digest('SHA-256', Buffer.from(verifier))));
  const page = await fetch(`${GATEWAY}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id ?? '', redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'acc', resource: `${GATEWAY}/mcp` })}`);
  const html = await page.text();
  const field = (n: string) => new RegExp(`name="${n}" value="([^"]+)"`).exec(html)?.[1] ?? '';
  const done = await fetch(`${GATEWAY}/oauth/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: (page.headers.get('set-cookie') ?? '').split(';')[0] },
    body: new URLSearchParams({ request: field('request'), csrf: field('csrf'), decision: 'allow' }),
  });
  const ready = await done.text();
  const back = new URL((/href="(https:\/\/claude\.ai[^"]+)"/.exec(ready)?.[1] ?? 'https://x.invalid/').replaceAll('&amp;', '&'));
  ctx.kitchen = /href="(\/approver\/[^"]+)"/.exec(ready)?.[1];
  const t = await http('/oauth/token', { body: { grant_type: 'authorization_code', code: back.searchParams.get('code'), redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier, resource: `${GATEWAY}/mcp` } });
  ctx.oauthToken = t.access_token;
  return {
    registered: reg.httpStatus,
    consentPage: page.status,
    consentShowsLimit: html.includes('500 €'),
    consentNotFramable: (page.headers.get('content-security-policy') ?? '').includes("frame-ancestors 'none'"),
    allowed: done.status,
    kitchenLink: Boolean(ctx.kitchen),
    backState: back.searchParams.get('state'),
    backIssIsDoor: back.searchParams.get('iss') === GATEWAY,
    tokenStatus: t.httpStatus,
    tokenType: t.token_type,
    expiresIn: t.expires_in,
    scope: t.scope,
    refresh: Boolean(t.refresh_token),
  };
}

/** One JSON-RPC call to the stateless /mcp with the connector token; the result and the raw reply text. */
async function connectorRpc(ctx: Ctx, method: string, params?: Json): Promise<{ httpStatus: number; text: string; result?: Json }> {
  const res = await fetch(`${GATEWAY}/mcp`, { method: 'POST', headers: { ...bearer(ctx.oauthToken), 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const text = await res.text();
  return { httpStatus: res.status, text, result: res.status < 400 ? rpcResult(text) : undefined };
}

/** Lists the MCP server's tools over streamable HTTP: initialize, initialized, tools/list. */
async function mcpTools(ctx: Ctx, buyer: string): Promise<Json> {
  const base = { ...bearer(ctx.agentKeys[buyer]), 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const send = async (msg: Json) => {
    const res = await fetch(`${GATEWAY}/mcp`, { method: 'POST', headers: { ...base, ...(ctx.mcpSession ? { 'Mcp-Session-Id': ctx.mcpSession } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', ...msg }) });
    ctx.mcpSession = res.headers.get('mcp-session-id') ?? ctx.mcpSession;
    return { status: res.status, text: await res.text() };
  };
  const init = await send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'acceptance', version: '0' } } });
  if (init.status >= 400) return { httpStatus: init.status, text: init.text };
  await send({ method: 'notifications/initialized' });
  const list = await send({ id: 2, method: 'tools/list' });
  return { httpStatus: list.status, tools: list.status < 400 ? rpcResult(list.text).tools : undefined };
}

/** One entry per runner step name; each returns the reply object the case expectations read. */
const handlers: Record<string, Handler> = {
  interpret: async (ctx, step, buyer) => {
    const r = await agent(ctx, buyer, '/v1/interpret', { text: step.input.text });
    ctx.draftId = r.draft?.id ?? ctx.draftId;
    return r;
  },
  confirm_draft: (ctx, step, buyer) => agent(ctx, buyer, `/v1/drafts/${ctx.draftId}/confirm`, { fill: step.input.fill }),
  search_products: (ctx, step, buyer) => agent(ctx, buyer, '/v1/search', step.input),
  resolve: (ctx, step, buyer) => agent(ctx, buyer, '/v1/resolve', step.input),
  list_families: (ctx, step, buyer) => http(`/v1/families?terms=${step.input.terms.map(encodeURIComponent).join(',')}`, { key: ctx.agentKeys[buyer] }),
  quote: (ctx, step, buyer, given) => quote(ctx, step, buyer, given),
  place_order: (ctx, step, buyer) => place(ctx, buyer, step.input.offer, { agentReason: step.input.agentReason, key: step.input.idempotencyKey }),
  quote_and_place: async (ctx, step, buyer, given) => {
    const q = await quote(ctx, { ...step, input: {} }, buyer, given);
    return { ...(await place(ctx, buyer, step.input.offer)), offerNetCents: q.offers?.[step.input.offer]?.netCents };
  },
  quote_and_place_concurrently: async (ctx, step, buyer, given) => {
    const { count, buyers, offer = 0 } = step.input;
    const who: string[] = buyers ?? Array.from({ length: count }, () => buyer);
    const quotes: Json[] = [];
    for (const b of who) quotes.push(await agent(ctx, b, '/v1/quotes', { draft: given.draft }));
    const replies = await Promise.all(
      who.map((b, i) =>
        agent(ctx, b, '/v1/orders', { quoteId: quotes[i].id, offerId: quotes[i].offers?.[offer]?.offerId }, { 'Idempotency-Key': randomUUID() }),
      ),
    );
    const first = (state: string) => {
      const r = replies.find((x) => x.state === state);
      return r && { ...r, netCents: r.order?.netCents ?? r.netCents };
    };
    return { states: replies.map((r) => r.state), accepted: first('ACCEPTED'), rejected: first('REJECTED') };
  },
  place_order_twice: async (ctx, step, buyer) => {
    const key = step.input.idempotencyKey;
    const a = await place(ctx, buyer, step.input.offer, { key });
    const b = await place(ctx, buyer, step.input.offer, { key });
    return { sameOrderId: a.orderId !== undefined && a.orderId === b.orderId, ordersForKey: await adminCount(`/admin/orders?idempotencyKey=${encodeURIComponent(key)}`) };
  },
  place_order_without_key: (ctx, step, buyer) => place(ctx, buyer, step.input.offer, { key: null }),
  place_order_same_key_other_body: async (ctx, step, buyer) => {
    await place(ctx, buyer, 0, { key: step.input.idempotencyKey, agentReason: 'first reason' });
    return place(ctx, buyer, 0, { key: step.input.idempotencyKey, agentReason: 'a different reason' });
  },
  quote_basket: async (ctx, _step, buyer, given) => {
    const r = await agent(ctx, buyer, '/v1/baskets', { needs: given.needs });
    ctx.basket[buyer] = r;
    return r;
  },
  place_basket: async (ctx, step, buyer, given) => {
    const b = ctx.basket[buyer];
    const offers: (number | null)[] = step.input.offers;
    const selections = given.needs.flatMap((_: Json, i: number) =>
      offers[i] === null ? [] : [{ quoteId: b?.quotes?.[i]?.id, offerId: b?.quotes?.[i]?.offers?.[offers[i]!]?.offerId }],
    );
    const reply = await agent(ctx, buyer, '/v1/orders', { basketId: b?.basketId, selections }, { 'Idempotency-Key': randomUUID() });
    await remember(ctx, buyer, reply);
    return { ...reply, acceptedLinesForBuyer: await adminCount(`/admin/ledger?buyer=${buyer}`) };
  },
  approve: (ctx, _step, buyer) => approve(ctx, buyer, false),
  approve_as_agent: (ctx, _step, buyer) => approve(ctx, buyer, true),
  get_order: (ctx, _step, buyer) => agent(ctx, buyer, `/v1/orders/${ctx.lastOrderId[buyer]}`),
  get_receipt: (ctx, _step, buyer) => agent(ctx, buyer, `/v1/orders/${ctx.lastOrderId[buyer]}/receipt`),
  get_quote_as: (ctx, step, buyer) => agent(ctx, step.input.buyer, `/v1/quotes/${ctx.lastQuote[buyer]?.id}`),
  set_clock: (_ctx, step) => admin('/admin/clock', { clock: step.input.clock }),
  set_replay_variant: (_ctx, step) => admin('/admin/replay', { variant: step.input }),
  http_get: (ctx, step, buyer) => http(step.input.path, { key: ctx.agentKeys[buyer] }),
  verify_offer_jws: async (ctx, step, buyer) => {
    const q = ctx.lastQuote[buyer];
    const o = q?.offers?.[step.input.offer];
    const claims = await verifyDoorJws(o?.jws);
    return { verified: claims !== null, claimsMatchOffer: claims?.quoteId === q?.id && claims?.offerId === o?.offerId && claims?.netCents === o?.netCents && claims?.aud === 'lazydoor:quote', claims };
  },
  place_order_with_jws: async (ctx, step, buyer) => {
    const q = ctx.lastQuote[buyer];
    const o = q?.offers?.[step.input.offer];
    const quoteJws = step.input.tamper === 'price' ? tamperedPrice(o?.jws) : o?.jws;
    const key = randomUUID();
    const reply = await agent(ctx, buyer, '/v1/orders', { quoteId: q?.id, offerId: o?.offerId, quoteJws }, { 'Idempotency-Key': key });
    await remember(ctx, buyer, reply);
    return { ...reply, ordersForKey: await adminCount(`/admin/orders?idempotencyKey=${key}`) };
  },
  verify_receipt_jws: async (ctx, _step, buyer) => {
    const order = await agent(ctx, buyer, `/v1/orders/${ctx.lastOrderId[buyer]}`);
    const receipt = await agent(ctx, buyer, `/v1/orders/${ctx.lastOrderId[buyer]}/receipt`);
    const claims = await verifyDoorJws(order.jws);
    return { verified: claims !== null, sameOnReceipt: receipt.jws === order.jws, claims };
  },
  audit_verify: () => auditVerify(),
  all_events: () => http('/v1/events?since=0', { key: ADMIN_KEY }),
  tamper_and_verify: async () => {
    const t = await admin('/admin/tamper', {});
    const v = await auditVerify();
    return { tampered: t.tampered, verify: v, namesTheSeq: v.firstBadSeq === t.tampered };
  },
  try: async (ctx, step) => {
    const body = step.input.answer ? { visitor: ctx.tryReply?.visitor, draftId: ctx.tryReply?.draft?.id, answer: step.input.answer } : { text: step.input.text, ...(ctx.tryReply?.visitor ? { visitor: ctx.tryReply.visitor } : {}) };
    ctx.tryReply = await http('/v1/try', { body });
    return ctx.tryReply;
  },
  try_other_visitor: async (ctx, step) => (ctx.otherTry = await http('/v1/try', { body: { text: step.input.text } })),
  try_raw: (_ctx, step) => http('/v1/try', { body: step.input }),
  admin_try: (_ctx, step) => admin('/admin/try', step.input),
  try_decision: (ctx, step) => {
    const visitor = step.input.visitor === 'other' ? ctx.otherTry?.visitor : ctx.tryReply?.visitor;
    return http('/v1/try/decision', { body: { visitor, token: ctx.tryReply?.approval?.token, decision: step.input.decision } });
  },
  try_decision_as_agent: (ctx, step, buyer) => http('/v1/try/decision', { key: ctx.agentKeys[buyer], body: { visitor: ctx.tryReply?.visitor, token: ctx.tryReply?.approval?.token, decision: step.input.decision } }),
  reset_and_verify: async (ctx) => {
    const r = await admin('/admin/reset', ctx.resetBody);
    ctx.agentKeys = r.agentKeys;
    ctx.approverKeys = r.approverKeys;
    const events = (await http('/v1/events?since=0', { key: ADMIN_KEY })).events ?? [];
    return { ...(await auditVerify()), firstPrevHash: events[0]?.prevHash };
  },
  mcp_list_tools: (ctx, _step, buyer) => mcpTools(ctx, buyer),
  peppol_export: async (ctx, _step, buyer) => {
    const res = await fetch(`${GATEWAY}/v1/orders/${ctx.lastOrderId[buyer]}/peppol`, { headers: bearer(ctx.agentKeys[buyer]) });
    const text = await res.text();
    return { httpStatus: res.status, contentType: res.headers.get('Content-Type'), text, ...(text.startsWith('{') ? JSON.parse(text) : {}) };
  },
  try_voice: async (_ctx, step) => {
    const res = await fetch(`${GATEWAY}/v1/try/voice`, { method: 'POST', headers: { 'Content-Type': step.input.type }, body: step.input.clip ? readFileSync(join(DIR, step.input.clip)) : (step.input.text ?? '') });
    return { httpStatus: res.status, ...((await res.json().catch(() => ({}))) as Json) };
  },
  connector_connect: (ctx) => connectorConnect(ctx),
  connector_tools: async (ctx) => {
    const r = await connectorRpc(ctx, 'tools/list');
    return { httpStatus: r.httpStatus, tools: r.result?.tools };
  },
  connector_order: async (ctx, step) => {
    const q = (await connectorRpc(ctx, 'tools/call', { name: 'get_quote', arguments: { draft: step.input.draft } })).result?.structuredContent;
    const r = await connectorRpc(ctx, 'tools/call', { name: 'place_order', arguments: { quoteId: q?.id, offerId: q?.offers?.[0]?.offerId, quoteJws: q?.offers?.[0]?.jws, idempotencyKey: randomUUID(), agentReason: step.input.agentReason } });
    ctx.connectorOrder = r.result?.structuredContent?.orderId;
    return { httpStatus: r.httpStatus, ...r.result?.structuredContent, carriesApprovalLink: /approve\/|approval_token|"token"/.test(r.text) };
  },
  connector_kitchen: async (ctx) => {
    const inbox = await http(ctx.kitchen ?? '/approver/none', { headers: { Accept: 'application/json' } });
    const hit = (inbox.pending ?? []).find((p: Json) => p.orderId === ctx.connectorOrder);
    ctx.connectorApproval = hit ? new URL(hit.url).pathname : undefined;
    return { httpStatus: inbox.httpStatus, approver: inbox.approver, listsTheOrder: Boolean(hit) };
  },
  connector_approve: (ctx, step) => http(ctx.connectorApproval ?? '/approve/none', { method: 'POST', headers: { Accept: 'application/json', ...(step.input.asConnector ? bearer(ctx.oauthToken) : {}) } }),
  connector_rest: (ctx) => http(`/v1/orders/${ctx.connectorOrder}`, { key: ctx.oauthToken }),
  cancel_order: async (ctx, step, buyer) => {
    const r = await agent(ctx, buyer, `/v1/orders/${ctx.lastOrderId[buyer]}/cancel`, step.input.reason ? { reason: step.input.reason } : {}, { 'Idempotency-Key': randomUUID() });
    const claims = await verifyDoorJws(r.jws);
    const verified = claims !== null && claims.aud === 'lazydoor:cancellation' && claims.orderId === r.orderId && claims.refundedNetCents === r.cancellation?.refundedNetCents;
    return { ...r, verified, tamperedVerifies: typeof r.jws === 'string' && (await verifyDoorJws(tamperedPrice(r.jws, 'refundedNetCents'))) !== null };
  },
  public_read: async (_ctx, step) => {
    const res = await fetch(`${GATEWAY}${step.input.path}`, { method: step.input.method ?? 'GET', headers: { Origin: 'http://localhost:8790' } });
    return { httpStatus: res.status, contentType: res.headers.get('Content-Type'), allowOrigin: res.headers.get('Access-Control-Allow-Origin'), allowCredentials: res.headers.get('Access-Control-Allow-Credentials'), link: res.headers.get('Link'), text: await res.text() };
  },
};

/** The reset body for a case: `defaults` plus the case `given`, only the fields `/admin/reset` reads. */
function resetBody(defaults: Json, given: Json): Json {
  const g = { mandate: defaults.mandate, clock: defaults.clock, replay: defaults.replay, ...given };
  return Object.fromEntries(['clock', 'replay', 'replayVariant', 'mandate', 'mandateTampered', 'mandateExp', 'priorAcceptedNetCents', 'priorAccepted'].map((k) => [k, g[k]]));
}

/**
 * Runs one case: health check (unreachable = FAIL, no model for an `interpret` case = BLOCKED), reset,
 * then every step in order; returns the verdict line and, for a FAIL, what went wrong.
 */
async function runCase(c: Case, defaults: Json): Promise<{ status: 'PASS' | 'FAIL' | 'BLOCKED_ON_GEMINI'; detail?: string }> {
  let health: Json;
  try {
    health = await http('/health');
  } catch {
    return { status: 'FAIL', detail: 'gateway unreachable' };
  }
  if (c.steps.some((s) => s.call === 'interpret') && health.models?.gemini === false) return { status: 'BLOCKED_ON_GEMINI' };
  let at = 'reset';
  try {
    const body = resetBody(defaults, c.given ?? {});
    const r = await admin('/admin/reset', body);
    if (!r.agentKeys) return { status: 'FAIL', detail: `reset failed: HTTP ${r.httpStatus}` };
    const ctx: Ctx = { agentKeys: r.agentKeys, approverKeys: r.approverKeys, given: c.given ?? {}, defaultBuyer: defaults.buyer, lastQuote: {}, lastOrderId: {}, basket: {}, tokens: {}, resetBody: body };
    for (const [i, step] of c.steps.entries()) {
      at = `step ${i + 1} ${step.call}`;
      const handler = handlers[step.call];
      if (!handler) return { status: 'FAIL', detail: `step ${i + 1}: unknown step "${step.call}"` };
      for (let n = 0; n < (step.repeat ?? 1); n++) {
        const reply = await handler(ctx, step, step.as ?? ctx.defaultBuyer, { ...ctx.given, ...step.given });
        for (const e of step.expect) {
          const m = match(reply, e);
          if (!m.ok) return { status: 'FAIL', detail: `step ${i + 1} ${step.call}: expected ${JSON.stringify(e)} got ${JSON.stringify(m.got)?.slice(0, 300)}` };
        }
      }
    }
    return { status: 'PASS' };
  } catch (err) {
    return { status: 'FAIL', detail: `${at}: ${(err as Error).message ?? err}` };
  }
}

/** Entry point: runs the selected cases and exits non-zero when any FAILs. */
async function main(): Promise<void> {
  const spec = JSON.parse(readFileSync(join(DIR, 'cases.json'), 'utf8'));
  const only = process.env.CASES?.split(',').map((s) => s.trim());
  const unknown = only?.filter((id) => !spec.cases.some((c: Case) => c.id === id));
  if (unknown?.length) {
    console.error(`unknown case id in CASES: ${unknown.join(', ')}`);
    process.exit(1);
  }
  const cases: Case[] = spec.cases.filter((c: Case) => !only || only.includes(c.id));
  const tally = { PASS: 0, FAIL: 0, BLOCKED_ON_GEMINI: 0 };
  const pause = Number(process.env.CASE_DELAY_MS ?? 0);
  for (const [i, c] of cases.entries()) {
    // a pause between cases keeps a door on the Workers Free plan inside its CPU allowance
    if (i && pause) await new Promise((r) => setTimeout(r, pause));
    const { status, detail } = await runCase(c, spec.defaults);
    tally[status]++;
    console.log(`${status} ${c.id} ${c.title}${detail ? `\n    ${detail}` : ''}`);
  }
  console.log(`\n${tally.PASS} PASS, ${tally.FAIL} FAIL, ${tally.BLOCKED_ON_GEMINI} BLOCKED_ON_GEMINI of ${cases.length}`);
  process.exit(tally.FAIL ? 1 : 0);
}

await main();
