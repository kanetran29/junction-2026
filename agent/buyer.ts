import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chooseWithinMandate, fillUnclear, type BuyerProfile, type Mandate, type PlanOffer } from './plan';

type Json = any;

/** What a run needs: where the gateway is, the agent's own key (never the approver's), the request and the buyer's standing profile. */
export interface BuyerOptions {
  gatewayUrl: string;
  apiKey: string;
  request: string;
  buyerProfile: BuyerProfile & Mandate;
  /** Reaches the gateway and Gemini; injected so tests can stub it. */
  fetchFn?: typeof fetch;
  geminiKey: string;
  model?: string;
  /** How often and how many times a HELD order is re-read while the human decides. */
  pollMs?: number;
  pollMax?: number;
  /** Waits out a Valio rate limit; injected so tests need no real sleep. */
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

/** One tool call the agent made and what came back (compacted, with no approval link). */
export interface TraceStep {
  tool: string;
  args: Json;
  result: Json;
}

/** The run's outcome: every tool call in order, the model's final answer and the last order it saw. */
export interface Trace {
  steps: TraceStep[];
  answer: string;
  order?: { orderId: string; state: string };
}

const DEFAULT_MODEL = 'gemini-3.8-flash';
const MAX_TURNS = 16;

/** The standing instructions: the agent buys within the door's rules and never tries to get around them. */
const systemPrompt = (p: BuyerProfile & Mandate) =>
  [
    "You are the purchasing agent of a hotel kitchen buying from a wholesaler through its gateway tools. 'Lazy at the order, strict at the border': you do the legwork, the gateway enforces the rules.",
    `Flow: interpret_request with the buyer's sentence, then confirm_draft (leave fill empty: the agent fills unclear fields from the buyer's profile), then get_quote with the draftId, then place_order with the quoteId and the offerId you chose.`,
    'get_quote returns offers and a `recommended` offerId (the cheapest covering offer, or one that stays within the automatic limit when it costs at most 5 % more). Place the recommended offer unless the offers show a clear reason not to, and send ONE sentence as agentReason saying why you chose it.',
    'A HELD order needs a named human approver: you cannot approve and must not look for a way to; the agent waits and reports. If a refusal has resolution `requote`, or the code is QUOTE_EXPIRED or PRICE_CHANGED, get a new quote once and choose again. Any other REJECTED order is final; never split an order or change the need to get under a limit. Report the reason code.',
    `Buyer profile: automatic limit ${(p.autoCents / 100).toFixed(2)} EUR per order, fat level ${p.fatLevel ?? 'any'}${p.packLitres ? `, preferred pack ${p.packLitres} l` : ''}.`,
    'Finish with a short plain answer: what was ordered, the price, the order state and, if HELD, who must approve.',
  ].join('\n');

/** Fetches JSON from the gateway MCP endpoint: plain JSON or the `data:` lines of an SSE reply. */
function rpcBody(text: string): Json {
  const data = text.trimStart().startsWith('{') ? text : text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('');
  return JSON.parse(data);
}

/** A minimal MCP client over streamable HTTP: initialize once, then `tools/list` and `tools/call` with the agent's bearer key. */
async function connectMcp(gatewayUrl: string, apiKey: string, fetchFn: typeof fetch) {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  let session: string | undefined;
  let id = 0;
  const send = async (method: string, params?: Json, notify = false): Promise<Json> => {
    const res = await fetchFn(`${gatewayUrl}/mcp`, {
      method: 'POST',
      headers: { ...headers, ...(session ? { 'Mcp-Session-Id': session } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id: ++id }), method, params }),
    });
    session = res.headers.get('mcp-session-id') ?? session;
    const text = await res.text();
    if (res.status >= 400) throw new Error(`gateway /mcp ${method}: HTTP ${res.status} ${text.slice(0, 200)}`);
    if (notify) return undefined;
    const body = rpcBody(text);
    if (body.error) throw new Error(`gateway /mcp ${method}: ${body.error.message}`);
    return body.result;
  };
  await send('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'lazydoor-buyer', version: '0.1.0' } });
  await send('notifications/initialized', undefined, true);
  const { tools } = await send('tools/list');
  return {
    tools: tools as { name: string; description: string; inputSchema: Json }[],
    /** Calls one tool and returns its structured reply; a refusal has no structured part, so its text JSON `{ error, detail }` is parsed instead. */
    call: async (name: string, args: Json): Promise<Json> => {
      const r = await send('tools/call', { name, arguments: args });
      return r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}');
    },
  };
}

/** The gateway's order reply cut to what the model and the trace need; the approval link never appears (it is not in the reply, and is dropped if it ever were). */
function compactOrder(r: Json): Json {
  return {
    orderId: r.orderId,
    state: r.state,
    reason: r.reason,
    outcome: r.decision?.outcome,
    reasons: (r.decision?.reasons ?? []).map((x: Json) => `${x.code}: ${x.detail}`),
    approver: r.approval?.status === 'pending' ? r.approval.approver : undefined,
    netCents: r.order?.netCents,
    grossCents: r.order?.grossCents,
    available: r.available,
    retryable: r.retryable,
    resolution: r.resolution,
    error: r.error,
    detail: r.detail,
  };
}

/** A quote cut to the offers (ids, products, quantity, price, changes), the first rejections, and the agent's recommendation. */
function compactQuote(q: Json, recommended?: string): Json {
  return {
    quoteId: q.id,
    recommended,
    offers: (q.offers ?? []).map((o: Json) => ({
      offerId: o.offerId,
      products: (o.lines ?? []).map((l: Json) => `${l.productId} x${l.salesUnits}`),
      filled: o.filled,
      shortfall: o.shortfall,
      netCents: o.netCents,
      changes: o.changes,
      reliability: o.reliability?.tri,
      estimate: o.estimate,
    })),
    rejections: (q.rejections ?? []).slice(0, 12).map((r: Json) => `${r.productId}: ${r.code}`),
    rejectionCount: (q.rejections ?? []).length,
  };
}

/** Runs one request end to end: Gemini proposes tool calls, the agent runs them over MCP and feeds the results back until the model answers. */
export async function runBuyer(opts: BuyerOptions): Promise<Trace> {
  const fetchFn = opts.fetchFn ?? fetch;
  const log = opts.log ?? ((l: string) => console.log(l));
  const profile = opts.buyerProfile;
  const mcp = await connectMcp(opts.gatewayUrl.replace(/\/$/, ''), opts.apiKey, fetchFn);
  const trace: Trace = { steps: [], answer: '' };
  let lastDraft: Json;

  /** Waits (bounded) for a human to decide a HELD order by re-reading it; the agent has no way to approve. */
  const waitForApprover = async (held: Json): Promise<Json> => {
    log(`    HELD: waiting for ${held.approval?.approver ?? 'the approver'} to approve order ${held.orderId}`);
    let current = held;
    for (let i = 0; i < (opts.pollMax ?? 10) && current.state === 'HELD'; i++) {
      await new Promise((r) => setTimeout(r, opts.pollMs ?? 3000));
      current = await mcp.call('get_order', { id: held.orderId });
      log(`    poll ${i + 1}: ${current.state}`);
    }
    return current;
  };

  /** Runs one tool call with the agent's own adjustments: profile fill on confirm, a recommendation on quotes, an idempotency key and the wait on orders; a VALIO_RATE_LIMITED reply of at most 60 s is waited out and the same call retried once. */
  const execute = async (name: string, rawArgs: Json): Promise<Json> => {
    let args = rawArgs ?? {};
    if (name === 'confirm_draft') args = { ...args, fill: { ...fillUnclear(lastDraft ?? { unclear: [] }, profile), ...(args.fill ?? {}) } };
    if (name === 'place_order') {
      args = { ...args, idempotencyKey: args.idempotencyKey ?? randomUUID() };
      log(`    reason sent: ${args.agentReason ?? '(none)'}`);
    }
    log(`> ${name} ${JSON.stringify(args)}`);
    let reply = await mcp.call(name, args);
    if (reply.error === 'VALIO_RATE_LIMITED' && reply.retryAfter <= 60) {
      log(`    Valio asked us to slow down: waiting ${reply.retryAfter} s, then retrying ${name} once`);
      await (opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))))(reply.retryAfter * 1000);
      reply = await mcp.call(name, args);
    }
    if (name === 'interpret_request' && reply.draft) lastDraft = reply.draft;
    if (name === 'get_quote' && reply.offers) {
      const pick = chooseWithinMandate(reply.offers as (PlanOffer & Json)[], profile);
      const compact = compactQuote(reply, pick?.offerId);
      for (const o of compact.offers) log(`    offer ${o.offerId}: ${o.products.join(' + ')} ${o.filled} filled, short ${o.shortfall}, ${(o.netCents / 100).toFixed(2)} EUR net${o.changes?.length ? `, changes ${o.changes.join(',')}` : ''}${o.offerId === pick?.offerId ? '  <- recommended' : ''}`);
      log(`    ${compact.rejectionCount} rejected: ${compact.rejections.slice(0, 5).join('; ')}`);
      return compact;
    }
    if (name === 'place_order' && reply.state) {
      const placed = compactOrder(reply);
      log(`    ${placed.state}${placed.reasons.length ? ` (${placed.reasons.join(' | ')})` : ''}`);
      trace.order = { orderId: reply.orderId, state: reply.state };
      if (reply.state === 'HELD') {
        const final = await waitForApprover(reply);
        trace.order = { orderId: reply.orderId, state: final.state };
        return { placed, afterWait: compactOrder(final) };
      }
      return placed;
    }
    if (name === 'get_order' && reply.state) return compactOrder(reply);
    if (name === 'search_products') return { ...reply, products: (reply.products ?? []).slice(0, 20) };
    return reply;
  };

  const declarations = mcp.tools.map((t) => {
    const { $schema: _drop, ...schema } = t.inputSchema;
    return { name: t.name, description: t.description, parametersJsonSchema: schema };
  });
  const contents: Json[] = [{ role: 'user', parts: [{ text: opts.request }] }];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${opts.model || DEFAULT_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.geminiKey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt(profile) }] }, contents, tools: [{ functionDeclarations: declarations }], generationConfig: { temperature: 0 } }),
    });
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const content = ((await res.json()) as Json).candidates?.[0]?.content;
    if (!content?.parts?.length) throw new Error('gemini returned no content');
    contents.push(content);
    const calls = content.parts.filter((p: Json) => p.functionCall);
    if (!calls.length) {
      trace.answer = content.parts.map((p: Json) => p.text ?? '').join('').trim();
      log(`\nANSWER: ${trace.answer}`);
      return trace;
    }
    const responses: Json[] = [];
    for (const { functionCall } of calls) {
      const result = await execute(functionCall.name, functionCall.args);
      trace.steps.push({ tool: functionCall.name, args: functionCall.args, result });
      responses.push({ functionResponse: { name: functionCall.name, response: result } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  throw new Error(`no final answer after ${MAX_TURNS} turns`);
}

/**
 * Command line: `GATEWAY_URL`, `ADMIN_KEY`, `GEMINI_API_KEY`, optional `AGENT_KEY` (else a demo reset mints the keys) and
 * the request as arguments. The demo reset also yields the approver inbox URL, which this wrapper prints for the human only.
 */
async function main(): Promise<void> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    console.log('BLOCKED_ON_GEMINI: set GEMINI_API_KEY');
    return;
  }
  const gatewayUrl = (process.env.GATEWAY_URL ?? 'http://localhost:8787').replace(/\/$/, '');
  const request = process.argv.slice(2).join(' ') || 'I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.';
  let apiKey = process.env.AGENT_KEY;
  if (!apiKey) {
    const res = await fetch(`${gatewayUrl}/admin/reset`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.ADMIN_KEY ?? 'dev-admin-key'}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ clock: '2026-11-13T21:10:00+02:00', replay: 'replies_2026-11-16' }),
    });
    const keys = (await res.json()) as Json;
    if (!keys.agentKeys) throw new Error(`reset failed: HTTP ${res.status}`);
    apiKey = keys.agentKeys['hotel-a'];
    console.log(`Human approver inbox: ${gatewayUrl}/approver/${keys.approverKeys['hotel-a']}`);
  }
  console.log(`Request: ${request}\n`);
  await runBuyer({
    gatewayUrl,
    apiKey: apiKey!,
    request,
    geminiKey,
    model: process.env.GEMINI_MODEL,
    buyerProfile: { autoCents: 50000, fatLevel: 'any' },
    pollMs: Number(process.env.POLL_MS ?? 3000),
    pollMax: Number(process.env.POLL_MAX ?? 10),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
