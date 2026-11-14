import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { insertStatements } from '../scripts/build-index';
import type { Env } from '../src/env';
import { createApp } from '../src/http/routes';
import * as S from '../src/http/schemas';
import { mcpRoutes } from '../src/mcp/tools';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fakeValio, product } from './quote-helpers';

const e = { ...(env as unknown as Env), DEMO_MODE: '1', VALIO_API_KEY: 'vk', ADMIN_KEY: 'adm', GEMINI_API_KEY: 'gk', GEMINI_MODEL: 'gm' };
const valio = fakeValio({ P1: { price: 3, stock: 250 } }).fn;
const app = createApp(valio);
app.route('/', mcpRoutes(valio));
const need = { category: '10400', claims: ['FREE_FROM_LACTOSE'], quantity: { value: 20, unit: 'l' }, deliverBy: '2026-11-16' };
const names = ['interpret_request', 'confirm_draft', 'search_products', 'get_quote', 'quote_basket', 'place_order', 'get_order', 'resolve_product', 'list_families'];

const post = (path: string, key: string | undefined, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers }, body: JSON.stringify(body) }, e);
const rpc = async (key: string | undefined, method: string, params?: unknown) => (await (await post('/mcp', key, { jsonrpc: '2.0', id: 1, method, params })).json()) as any;
const callTool = async (key: string, name: string, args: unknown) => (await rpc(key, 'tools/call', { name, arguments: args })).result;
const reset = async (body: Record<string, unknown> = {}) =>
  (await (await post('/admin/reset', 'adm', { clock: '2026-11-13T21:10:00+02:00', replay: null, replayVariant: {}, mandate: { perOrder: { auto: 500, hard: 5000 }, perDay: { auto: 500, hard: 10000 }, reliabilityFloor: 0.9, approver: 'Kitchen manager' }, ...body })).json()) as any;

beforeAll(async () => {
  await e.DB.batch(insertStatements([product('P1', { names: [{ language: 'fi', value: 'Maito' }] })]).map((s) => e.DB.prepare(s)));
  await e.DB.prepare("INSERT OR REPLACE INTO category_names(category, names, tag_source) VALUES ('10400','Milk','reviewed')").run();
});

describe('mcp', () => {
  it('requires the same bearer key as HTTP', async () => {
    expect((await post('/mcp', undefined, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401);
    expect((await post('/mcp', 'adm', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(403);
  });

  it('initializes as lazydoor and lists 9 tools whose schemas are the HTTP ones', async () => {
    const keys = await reset();
    const key = keys.agentKeys['hotel-a'];
    const init = await rpc(key, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    expect(init.result.serverInfo).toMatchObject({ name: 'lazydoor', version: '0.1.0' });
    const { tools } = (await rpc(key, 'tools/list')).result;
    expect(tools.map((t: any) => t.name)).toEqual(names);
    for (const t of tools) expect(t.outputSchema).toMatchObject({ type: 'object' });
    const by = Object.fromEntries(tools.map((t: any) => [t.name, t]));
    const expected = (s: z.ZodType) => ({ type: 'object', ...z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }) });
    expect(by.interpret_request.inputSchema).toEqual(expected(S.InterpretBody));
    expect(by.search_products.inputSchema).toEqual(expected(S.SearchBody));
    expect(by.get_quote.inputSchema).toEqual(expected(S.QuoteBody));
    expect(by.quote_basket.inputSchema).toEqual(expected(S.BasketBody));
    expect(by.resolve_product.inputSchema).toEqual(expected(S.ResolveBody));
    expect(by.list_families.inputSchema).toEqual(expected(S.FamiliesQuery));
    expect(by.get_order.inputSchema).toEqual(expected(S.IdParam));
  });

  it('place_order via MCP returns the same JSON as HTTP; get_order and a typed error work', async () => {
    const keys = await reset();
    const key = keys.agentKeys['hotel-a'];
    const search = await callTool(key, 'search_products', { category: '10400', claims: ['FREE_FROM_LACTOSE'] });
    expect(search.isError).toBe(false);
    expect(search.structuredContent).toMatchObject({ valioCalls: 0, products: [{ id: 'P1' }] });
    const q = (await callTool(key, 'get_quote', need)).structuredContent;
    expect(q.offers[0].netCents).toBe(6000);
    const placed = await callTool(key, 'place_order', { quoteId: q.id, offerId: q.offers[0].offerId, idempotencyKey: 'm1' });
    expect(placed.isError).toBe(false);
    expect(JSON.parse(placed.content[0].text)).toEqual(placed.structuredContent);
    const http = await (await post('/v1/orders', key, { quoteId: q.id, offerId: q.offers[0].offerId }, { 'Idempotency-Key': 'm1' })).json() as any;
    expect(placed.structuredContent).toEqual(http);
    expect((await callTool(key, 'get_order', { id: http.orderId })).structuredContent).toEqual(http);
    const missing = await callTool(key, 'get_order', { id: 'nope' });
    expect(missing).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('ORDER_NOT_FOUND') }] });
    const noKey = await callTool(key, 'place_order', { quoteId: q.id, offerId: q.offers[0].offerId });
    expect(noKey).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('INVALID_REQUEST') }] });
    expect(noKey.structuredContent).toBeUndefined();
    expect(await callTool(key, 'get_quote', { draft: { category: '10400' } })).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('INVALID_REQUEST') }] });
  });

  it('a REJECTED order sets isError', async () => {
    const keys = await reset({ mandateTampered: true });
    const key = keys.agentKeys['hotel-a'];
    const q = (await callTool(key, 'get_quote', need)).structuredContent;
    const r = await callTool(key, 'place_order', { quoteId: q.id, offerId: q.offers[0].offerId, idempotencyKey: 'm2' });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ state: 'REJECTED' });
  });

  it('HELD is not an error, an unknown tool is a protocol error, GET is 405, internal errors are masked', async () => {
    const keys = await reset();
    const key = keys.agentKeys['hotel-a'];
    const big = { ...need, quantity: { value: 200, unit: 'l' } };
    const q = (await callTool(key, 'get_quote', big)).structuredContent;
    const held = await callTool(key, 'place_order', { quoteId: q.id, offerId: q.offers[0].offerId, idempotencyKey: 'h1' });
    expect(held).toMatchObject({ isError: false, structuredContent: { state: 'HELD' } });
    expect((await rpc(key, 'tools/call', { name: 'nope', arguments: {} })).error.code).toBe(-32602);
    expect((await app.request('/mcp', { headers: { Authorization: `Bearer ${key}`, Accept: 'text/event-stream' } }, e)).status).toBe(405);
    const db = { prepare: (sql: string) => (sql.includes('api_keys') ? e.DB.prepare(sql) : (() => { throw new TypeError('secret internals'); })()), batch: e.DB.batch.bind(e.DB) } as unknown as D1Database;
    const masked = (await (await app.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_families', arguments: {} } }) }, { ...e, DB: db })).json()) as any;
    expect(masked.result).toMatchObject({ isError: true, content: [{ text: JSON.stringify({ error: 'INTERNAL_ERROR', detail: 'unexpected failure' }) }] });
  });

  it('an SDK client lists tools and receives a refusal as an isError result, not a thrown error', async () => {
    const keys = await reset();
    const client = new Client({ name: 'sdk', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL('http://door/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${keys.agentKeys['hotel-a']}` } },
      fetch: ((u: any, i: any) => app.request(new Request(u, i), undefined, e)) as typeof fetch,
    }));
    expect((await client.listTools()).tools).toHaveLength(9);
    const r = await client.callTool({ name: 'get_order', arguments: { id: 'nope' } });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain('ORDER_NOT_FOUND');
    const by = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t]));
    expect(by.confirm_draft.inputSchema).toMatchObject({ required: ['id', 'fill'] });
    const branches = (by.place_order.inputSchema as any).anyOf;
    expect(branches).toHaveLength(2);
    for (const b of branches) expect(b.required).toContain('idempotencyKey');
    for (const b of branches) expect(b.properties.idempotencyKey.description).toContain('Unique per order attempt');
  });
});
