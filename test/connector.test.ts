import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertStatements } from '../scripts/build-index';
import { db } from '../src/db';
import type { Env } from '../src/env';
import { createApp } from '../src/http/routes';
import { mcpRoutes } from '../src/mcp/tools';
import { b64u } from '../src/util';
import { clearValioBlock } from '../src/valio/client';
import { fakeValio, product } from './quote-helpers';

const ORIGIN = 'https://door.example';
const e = { ...(env as unknown as Env), DEMO_MODE: '1', VALIO_API_KEY: 'vk', ADMIN_KEY: 'adm', GEMINI_API_KEY: 'gk', GEMINI_MODEL: 'gemini-test', GEMMA_MODEL: 'gemma-test' };
const valio = fakeValio({ P1: { price: 3, stock: 5000 } }).fn;
/** Client ID metadata documents the stub serves, by URL. */
const documents = new Map<string, unknown>();
const upstream = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  if (documents.has(u)) return new Response(JSON.stringify(documents.get(u)), { headers: { 'Content-Type': 'application/json' } });
  return valio(url, init);
}) as typeof fetch;
const app = createApp(upstream);
app.route('/', mcpRoutes(upstream));
const json = async (r: Response) => (await r.json()) as any;
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';

/** One request to the door at its public origin. */
const req = (path: string, init: RequestInit = {}) => app.request(`${ORIGIN}${path}`, { ...init, headers: { 'CF-Connecting-IP': '198.51.100.7', ...(init.headers as Record<string, string>) } }, e);
/** A PKCE pair: a random verifier and its S256 challenge. */
async function pkce() {
  const verifier = b64u(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}
/** Registers a public client (dynamic client registration) and returns its client_id. */
async function register(redirect = CLAUDE): Promise<string> {
  const r = await req('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirect], token_endpoint_auth_method: 'none' }) });
  expect(r.status).toBe(201);
  return (await json(r)).client_id;
}
/** Opens the consent page; returns the response, its csrf cookie and the form's hidden fields. */
async function authorize(params: Record<string, string>) {
  const r = await req(`/oauth/authorize?${new URLSearchParams(params)}`);
  const html = r.status === 200 ? await r.text() : '';
  const cookie = (r.headers.get('Set-Cookie') ?? '').split(';')[0];
  const field = (name: string) => new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1] ?? '';
  return { r, html, cookie, request: field('request'), csrf: field('csrf') };
}
/** Submits the consent form; returns the result page and the links on it. */
async function consent(a: Awaited<ReturnType<typeof authorize>>, o: { decision?: string; cookie?: string; csrf?: string } = {}) {
  const r = await req('/oauth/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: o.cookie ?? a.cookie },
    body: new URLSearchParams({ request: a.request, csrf: o.csrf ?? a.csrf, decision: o.decision ?? 'allow' }).toString(),
  });
  const html = r.status === 200 ? await r.text() : '';
  const back = /href="(https:\/\/claude\.ai[^"]+)"/.exec(html)?.[1]?.replaceAll('&amp;', '&') ?? r.headers.get('Location') ?? '';
  const kitchen = /href="(\/approver\/[^"]+)"/.exec(html)?.[1] ?? '';
  return { r, html, back, kitchen, code: back ? new URL(back).searchParams.get('code') : null };
}
/** POSTs a form to the token endpoint. */
const token = (form: Record<string, string>) => req('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
/** The whole flow for one client: returns its tokens, kitchen link and PKCE pair. */
async function connect(clientId?: string) {
  const client = clientId ?? (await register());
  const p = await pkce();
  const a = await authorize({ response_type: 'code', client_id: client, redirect_uri: CLAUDE, code_challenge: p.challenge, code_challenge_method: 'S256', state: 'st-1', resource: `${ORIGIN}/mcp`, scope: 'agent' });
  const c = await consent(a);
  const t = await json(await token({ grant_type: 'authorization_code', code: c.code!, redirect_uri: CLAUDE, client_id: client, code_verifier: p.verifier, resource: `${ORIGIN}/mcp` }));
  return { client, ...t, kitchen: c.kitchen };
}
/** One JSON-RPC call to /mcp with a bearer token. */
const rpc = async (bearer: string | undefined, method: string, params?: unknown) =>
  req('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
const setFlag = (on: boolean) => db(e).prepare(on ? "INSERT INTO settings(key, value) VALUES ('feature_connector', '1') ON CONFLICT (key) DO UPDATE SET value = '1'" : "DELETE FROM settings WHERE key = 'feature_connector'").run();

afterEach(() => clearValioBlock());
beforeAll(async () => {
  await e.DB.batch(insertStatements([product('P1')]).map((s) => e.DB.prepare(s)));
  await e.DB.prepare("INSERT OR REPLACE INTO category_names(category, names, tag_source) VALUES ('10400','Milk','reviewed')").run();
});
beforeEach(async () => {
  await app.request('/admin/reset', { method: 'POST', headers: { Authorization: 'Bearer adm', 'Content-Type': 'application/json' }, body: JSON.stringify({ clock: '2026-11-13T21:10:00+02:00', replay: null, replayVariant: {} }) }, e);
  await setFlag(true);
});

describe('connector switched off', () => {
  it('has no OAuth routes or metadata, and /mcp answers 401 as before', async () => {
    await setFlag(false);
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server', '/oauth/authorize?client_id=x']) expect((await req(path)).status, path).toBe(404);
    expect((await req('/oauth/register', { method: 'POST', body: '{}' })).status).toBe(404);
    const r = await rpc(undefined, 'tools/list');
    expect(r.status).toBe(401);
    expect(r.headers.get('WWW-Authenticate')).toBeNull();
  });
});

describe('discovery (MCP authorization)', () => {
  it('publishes protected-resource and authorization-server metadata, and /mcp points to them on 401', async () => {
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      expect(await json(await req(path))).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN], bearer_methods_supported: ['header'] });
    }
    expect(await json(await req('/.well-known/oauth-authorization-server'))).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
    });
    const r = await rpc(undefined, 'tools/list');
    expect(r.status).toBe(401);
    expect(r.headers.get('WWW-Authenticate')).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="agent"`);
  });
});

describe('client registration', () => {
  it('registers a public client with https (or loopback http) redirect URIs only', async () => {
    const ok = await req('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CLAUDE, 'http://localhost:6274/oauth/callback'] }) });
    expect(ok.status).toBe(201);
    expect(await json(ok)).toMatchObject({ client_id: expect.any(String), redirect_uris: [CLAUDE, 'http://localhost:6274/oauth/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] });
    for (const bad of [{}, { redirect_uris: [] }, { redirect_uris: ['http://evil.example/cb'] }, { redirect_uris: ['javascript:alert(1)'] }, { redirect_uris: ['https://x.example/cb#frag'] }]) {
      const r = await req('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bad) });
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(await json(r)).toMatchObject({ error: 'invalid_redirect_uri' });
    }
  });
});

describe('the whole flow, as Claude does it', () => {
  it('consent opens a sandbox kitchen, the code needs the PKCE verifier, and the token orders through /mcp', async () => {
    const client = await register();
    const p = await pkce();
    const a = await authorize({ response_type: 'code', client_id: client, redirect_uri: CLAUDE, code_challenge: p.challenge, code_challenge_method: 'S256', state: 'st-1', resource: `${ORIGIN}/mcp` });
    expect(a.r.status).toBe(200);
    expect(a.r.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(a.cookie).toMatch(/^lz_oauth=/);
    expect(a.r.headers.get('Set-Cookie')).toContain('SameSite=Strict');
    expect(a.html).toContain('Claude');
    expect(a.html).toContain('claude.ai');
    expect(a.html).toContain('500');
    const c = await consent(a);
    expect(c.r.status).toBe(200);
    expect(c.kitchen).toMatch(/^\/approver\/ap_/);
    const back = new URL(c.back);
    expect([back.origin + back.pathname, back.searchParams.get('state'), back.searchParams.get('iss')]).toEqual([CLAUDE, 'st-1', ORIGIN]);
    const wrong = await token({ grant_type: 'authorization_code', code: c.code!, redirect_uri: CLAUDE, client_id: client, code_verifier: (await pkce()).verifier });
    expect([wrong.status, (await json(wrong)).error]).toEqual([400, 'invalid_grant']);
    const t = await token({ grant_type: 'authorization_code', code: c.code!, redirect_uri: CLAUDE, client_id: client, code_verifier: p.verifier, resource: `${ORIGIN}/mcp` });
    expect(t.status).toBe(400);
    const c2 = await consent(await authorize({ response_type: 'code', client_id: client, redirect_uri: CLAUDE, code_challenge: p.challenge, code_challenge_method: 'S256', state: 's' }));
    const ok = await token({ grant_type: 'authorization_code', code: c2.code!, redirect_uri: CLAUDE, client_id: client, code_verifier: p.verifier });
    expect(ok.headers.get('Cache-Control')).toBe('no-store');
    const tokens = await json(ok);
    expect(tokens).toMatchObject({ access_token: expect.any(String), refresh_token: expect.any(String), token_type: 'Bearer', expires_in: 3600, scope: 'agent' });
    const list = await json(await rpc(tokens.access_token, 'tools/list'));
    expect(list.result.tools.map((x: any) => x.name)).toContain('place_order');
  });

  it("binds the token to the visitor's own sandbox: it orders, never sees an approval link, and can never approve", async () => {
    const t = await connect();
    const call = async (name: string, args: unknown) => (await json(await rpc(t.access_token, 'tools/call', { name, arguments: args }))).result;
    const q = (await call('get_quote', { draft: { category: '10400', claims: ['FREE_FROM_LACTOSE'], quantity: { value: 200, unit: 'l' }, deliverBy: '2026-11-16' } })).structuredContent;
    const placed = await call('place_order', { quoteId: q.id, offerId: q.offers[0].offerId, idempotencyKey: crypto.randomUUID() });
    expect(placed.structuredContent).toMatchObject({ state: 'HELD', approval: { status: 'pending', approver: 'You (kitchen manager)' } });
    expect(JSON.stringify(placed)).not.toMatch(/approve\/|approval_token|"token"/);
    const owner = await db(e).prepare('SELECT buyer_id, approval_token FROM orders WHERE id = ?').bind(placed.structuredContent.orderId).first<{ buyer_id: string; approval_token: string }>();
    expect(owner!.buyer_id).toMatch(/^visitor-/);
    const kitchen = await req(t.kitchen, { headers: { Accept: 'application/json' } });
    expect((await json(kitchen)).pending.map((x: any) => x.orderId)).toEqual([placed.structuredContent.orderId]);
    const self = await req(`/approve/${owner!.approval_token}`, { method: 'POST', headers: { Authorization: `Bearer ${t.access_token}`, Accept: 'application/json' } });
    expect(self.status).toBe(403);
    const visitorDecision = await req('/v1/try/decision', { method: 'POST', headers: { Authorization: `Bearer ${t.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ visitor: 'v', token: owner!.approval_token, decision: 'approve' }) });
    expect(visitorDecision.status).toBe(403);
    expect((await req('/v1/quotes/q1', { headers: { Authorization: `Bearer ${t.access_token}` } })).status).toBe(401);
  });

  it('refreshes by rotation; an evicted sandbox ends its tokens; a reset ends every token', async () => {
    const t = await connect();
    const r1 = await json(await token({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: t.client }));
    expect(r1).toMatchObject({ access_token: expect.any(String), refresh_token: expect.any(String) });
    expect((await rpc(r1.access_token, 'tools/list')).status).toBe(200);
    await db(e).prepare("DELETE FROM try_visitors WHERE buyer_id LIKE 'visitor-%'").run();
    expect((await rpc(r1.access_token, 'tools/list')).status).toBe(401);
    const t3 = await connect();
    const r3 = await json(await token({ grant_type: 'refresh_token', refresh_token: t3.refresh_token, client_id: t3.client }));
    expect((await rpc(r3.access_token, 'tools/list')).status).toBe(200);
    expect((await token({ grant_type: 'refresh_token', refresh_token: t3.refresh_token, client_id: t3.client })).status).toBe(400);
    expect((await rpc(r3.access_token, 'tools/list')).status, 'a reused refresh token revokes the whole grant').toBe(401);
    const t2 = await connect();
    await app.request('/admin/reset', { method: 'POST', headers: { Authorization: 'Bearer adm', 'Content-Type': 'application/json' }, body: JSON.stringify({ clock: '2026-11-13T21:10:00+02:00' }) }, e);
    await setFlag(true);
    expect((await rpc(t2.access_token, 'tools/list')).status).toBe(401);
  });

  it('keeps API-key access to /mcp exactly as before', async () => {
    const keys = await json(await app.request('/admin/reset', { method: 'POST', headers: { Authorization: 'Bearer adm', 'Content-Type': 'application/json' }, body: JSON.stringify({ clock: '2026-11-13T21:10:00+02:00' }) }, e));
    const r = await rpc(keys.agentKeys['hotel-a'], 'tools/list');
    expect(r.status).toBe(200);
  });

  it('limits each token to 60 MCP calls a minute', async () => {
    const t = await connect();
    for (let i = 0; i < 60; i++) expect((await rpc(t.access_token, 'tools/list')).status, `call ${i}`).toBe(200);
    expect((await rpc(t.access_token, 'tools/list')).status).toBe(429);
  });
});

describe('authorization request checks', () => {
  it('never redirects to an unregistered redirect URI or an unknown client', async () => {
    const client = await register();
    const p = await pkce();
    for (const params of [{ client_id: client, redirect_uri: 'https://evil.example/cb' }, { client_id: 'nope', redirect_uri: CLAUDE }, { client_id: client, redirect_uri: `${CLAUDE}?x=1` }]) {
      const r = await req(`/oauth/authorize?${new URLSearchParams({ response_type: 'code', code_challenge: p.challenge, code_challenge_method: 'S256', ...params })}`);
      expect(r.status, JSON.stringify(params)).toBe(400);
      expect(r.headers.get('Location')).toBeNull();
    }
  });

  it('requires PKCE with S256 and a resource on this door, refusing on a page and never redirecting before consent', async () => {
    const client = await register('https://evil.example/cb');
    const p = await pkce();
    const base = { response_type: 'code', client_id: client, redirect_uri: 'https://evil.example/cb', state: 's9' };
    for (const params of [
      { ...base },
      { ...base, code_challenge: p.challenge, code_challenge_method: 'plain' },
      { ...base, code_challenge: p.challenge, code_challenge_method: 'S256', response_type: 'token' },
      { ...base, code_challenge: p.challenge, code_challenge_method: 'S256', resource: 'https://other.example/mcp' },
    ]) {
      const r = await req(`/oauth/authorize?${new URLSearchParams(params as Record<string, string>)}`);
      expect(r.status, JSON.stringify(params)).toBe(400);
      expect(r.headers.get('Location')).toBeNull();
    }
  });

  it('matches a loopback redirect on any port, and limits the consent form to the client origin', async () => {
    const client = await register('http://127.0.0.1:6274/callback');
    const p = await pkce();
    const a = await authorize({ response_type: 'code', client_id: client, redirect_uri: 'http://127.0.0.1:51123/callback', code_challenge: p.challenge, code_challenge_method: 'S256' });
    expect(a.r.status).toBe(200);
    expect(a.r.headers.get('Content-Security-Policy')).toContain("form-action 'self' http://127.0.0.1:51123");
    expect((await req(`/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: client, redirect_uri: 'http://127.0.0.1:51123/other', code_challenge: p.challenge, code_challenge_method: 'S256' })}`)).status).toBe(400);
  });

  it('refuses a consent without its cookie, with a wrong csrf value, twice, or after a cancel', async () => {
    const client = await register();
    const p = await pkce();
    const params = { response_type: 'code', client_id: client, redirect_uri: CLAUDE, code_challenge: p.challenge, code_challenge_method: 'S256', state: 's' };
    const a = await authorize(params);
    expect((await consent(a, { cookie: '' })).r.status).toBe(403);
    expect((await consent(a, { csrf: 'x'.repeat(43) })).r.status).toBe(403);
    expect((await consent(a)).r.status).toBe(200);
    expect((await consent(a)).r.status).toBe(403);
    const d = await consent(await authorize(params), { decision: 'deny' });
    expect(d.r.status).toBe(302);
    expect(new URL(d.r.headers.get('Location')!).searchParams.get('error')).toBe('access_denied');
    expect(await db(e).prepare("SELECT COUNT(*) AS n FROM try_visitors WHERE buyer_id LIKE 'visitor-%'").first()).toEqual({ n: 1 });
  });

  it('accepts a code once, only for its own client and redirect URI', async () => {
    const [a, b] = [await register(), await register()];
    const p = await pkce();
    const c = await consent(await authorize({ response_type: 'code', client_id: a, redirect_uri: CLAUDE, code_challenge: p.challenge, code_challenge_method: 'S256' }));
    expect((await json(await token({ grant_type: 'authorization_code', code: c.code!, redirect_uri: CLAUDE, client_id: b, code_verifier: p.verifier }))).error).toBe('invalid_grant');
    const c2 = await consent(await authorize({ response_type: 'code', client_id: a, redirect_uri: CLAUDE, code_challenge: p.challenge, code_challenge_method: 'S256' }));
    expect((await json(await token({ grant_type: 'authorization_code', code: c2.code!, redirect_uri: 'https://claude.ai/other', client_id: a, code_verifier: p.verifier }))).error).toBe('invalid_grant');
    const c3 = await consent(await authorize({ response_type: 'code', client_id: a, redirect_uri: CLAUDE, code_challenge: p.challenge, code_challenge_method: 'S256' }));
    expect((await token({ grant_type: 'authorization_code', code: c3.code!, redirect_uri: CLAUDE, client_id: a, code_verifier: p.verifier })).status).toBe(200);
    const issued = await json(await token({ grant_type: 'authorization_code', code: c3.code!, redirect_uri: CLAUDE, client_id: a, code_verifier: p.verifier }));
    expect(issued.error).toBe('invalid_grant');
    const c4 = await consent(await authorize({ response_type: 'code', client_id: a, redirect_uri: CLAUDE, code_challenge: p.challenge, code_challenge_method: 'S256' }));
    const t4 = await json(await token({ grant_type: 'authorization_code', code: c4.code!, redirect_uri: CLAUDE, client_id: a, code_verifier: p.verifier }));
    expect((await rpc(t4.access_token, 'tools/list')).status).toBe(200);
    await token({ grant_type: 'authorization_code', code: c4.code!, redirect_uri: CLAUDE, client_id: a, code_verifier: p.verifier });
    expect((await rpc(t4.access_token, 'tools/list')).status, 'a reused code revokes the tokens it issued').toBe(401);
    expect((await json(await token({ grant_type: 'password', username: 'x' }))).error).toBe('unsupported_grant_type');
  });
});

describe('client ID metadata documents', () => {
  it('uses an https client_id document when its client_id and redirect URIs match', async () => {
    const id = 'https://claude.example/oauth/client.json';
    documents.set(id, { client_id: id, client_name: 'Claude (metadata)', redirect_uris: [CLAUDE] });
    const t = await connect(id);
    expect(t.access_token).toEqual(expect.any(String));
    const bad = 'https://claude.example/oauth/mismatch.json';
    documents.set(bad, { client_id: 'https://somewhere.else/client.json', client_name: 'X', redirect_uris: [CLAUDE] });
    const p = await pkce();
    expect((await req(`/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: bad, redirect_uri: CLAUDE, code_challenge: p.challenge, code_challenge_method: 'S256' })}`)).status).toBe(400);
    expect((await req(`/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: 'https://claude.ai/elsewhere', code_challenge: p.challenge, code_challenge_method: 'S256' })}`)).status).toBe(400);
    const self = `${ORIGIN}/oauth/client.json`;
    documents.set(self, { client_id: self, client_name: 'Loop', redirect_uris: [CLAUDE] });
    expect((await req(`/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: self, redirect_uri: CLAUDE, code_challenge: p.challenge, code_challenge_method: 'S256' })}`)).status, 'never fetches its own origin').toBe(400);
  });
});
