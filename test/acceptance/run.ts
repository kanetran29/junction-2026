import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
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
};
type Handler = (ctx: Ctx, step: Step, buyer: string, given: Json) => Promise<Json>;

const GATEWAY = (process.env.GATEWAY_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const ADMIN_KEY = process.env.ADMIN_KEY ?? 'dev-admin-key';
const DIR = process.env.ACCEPTANCE_DIR ?? 'research/acceptance';
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

const admin = (path: string, body?: Json) => http(path, { key: ADMIN_KEY, body });

/** Posts to the gateway as a buyer's agent. */
const agent = (ctx: Ctx, buyer: string, path: string, body?: Json, headers?: Record<string, string>) =>
  http(path, { key: ctx.agentKeys[buyer], body, headers });

/** Quotes the step's draft (or basket need) for a buyer and remembers the quote as the buyer's latest. */
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
  if (reply.orderId) ctx.lastOrderId[buyer] = reply.orderId;
  return reply;
}

/** Counts rows of an admin list endpoint (`{ count }`). */
const adminCount = async (path: string) => (await admin(path)).count;

/**
 * Finds the approval token of a buyer's latest order in the approver inbox (cached so a second `approve`
 * reuses it) and posts the approval, with the agent key when `asAgent` (which must be refused).
 */
async function approve(ctx: Ctx, buyer: string, asAgent: boolean): Promise<Json> {
  const orderId = ctx.lastOrderId[buyer];
  if (!ctx.tokens[orderId]) {
    const inbox = await http(`/approver/${ctx.approverKeys[buyer]}`, { headers: { Accept: 'application/json' } });
    const hit = (inbox.pending ?? []).find((p: Json) => p.orderId === orderId);
    if (!hit) throw new Error(`no pending approval for order ${orderId} in the approver inbox`);
    ctx.tokens[orderId] = hit.token;
  }
  return http(`/approve/${ctx.tokens[orderId]}`, { method: 'POST', key: asAgent ? ctx.agentKeys[buyer] : undefined });
}

/** Decodes a JSON-RPC reply that arrives either as plain JSON or as an SSE `data:` stream. */
function rpcResult(text: string): Json {
  const data = text.trimStart().startsWith('{') ? text : text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('');
  return JSON.parse(data).result;
}

/** Lists the MCP server's tools over streamable HTTP: initialize, initialized, tools/list. */
async function mcpTools(ctx: Ctx): Promise<Json> {
  const base = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
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
    if (reply.orderId) ctx.lastOrderId[buyer] = reply.orderId;
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
  mcp_list_tools: (ctx) => mcpTools(ctx),
};

/** Resets gateway state for a case from `defaults` plus the case `given`; returns the minted keys. */
async function reset(defaults: Json, given: Json) {
  const g = { mandate: defaults.mandate, clock: defaults.clock, replay: defaults.replay, ...given };
  const body = Object.fromEntries(
    ['clock', 'replay', 'replayVariant', 'mandate', 'mandateTampered', 'mandateExp', 'priorAcceptedNetCents', 'priorAccepted'].map((k) => [k, g[k]]),
  );
  return admin('/admin/reset', body);
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
  try {
    const r = await reset(defaults, c.given ?? {});
    if (!r.agentKeys) return { status: 'FAIL', detail: `reset failed: HTTP ${r.httpStatus}` };
    const ctx: Ctx = { agentKeys: r.agentKeys, approverKeys: r.approverKeys, given: c.given ?? {}, defaultBuyer: defaults.buyer, lastQuote: {}, lastOrderId: {}, basket: {}, tokens: {} };
    for (const [i, step] of c.steps.entries()) {
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
    return { status: 'FAIL', detail: String((err as Error).message ?? err) };
  }
}

/** Entry point: runs the selected cases and exits non-zero when any FAILs. */
async function main(): Promise<void> {
  const spec = JSON.parse(readFileSync(join(DIR, 'cases.json'), 'utf8'));
  const only = process.env.CASES?.split(',').map((s) => s.trim());
  const cases: Case[] = spec.cases.filter((c: Case) => !only || only.includes(c.id));
  const tally = { PASS: 0, FAIL: 0, BLOCKED_ON_GEMINI: 0 };
  for (const c of cases) {
    const { status, detail } = await runCase(c, spec.defaults);
    tally[status]++;
    console.log(`${status} ${c.id} ${c.title}${detail ? `\n    ${detail}` : ''}`);
  }
  console.log(`\n${tally.PASS} PASS, ${tally.FAIL} FAIL, ${tally.BLOCKED_ON_GEMINI} BLOCKED_ON_GEMINI of ${cases.length}`);
  process.exit(tally.FAIL ? 1 : 0);
}

await main();
