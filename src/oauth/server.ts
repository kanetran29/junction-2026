import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { featureOn } from '../clock';
import { db } from '../db';
import type { Env } from '../env';
import { newKey } from '../http/admin';
import { HttpError, bearerOf, sameSecret } from '../http/auth';
import { SANDBOX_IDLE_MS, SANDBOX_MANDATE, TRY_APPROVER, addressBucket, limit, limitAddress, openSandbox } from '../try/sandbox';
import { escapeHtml, page } from '../ui/approve';
import { b64u, sha256Hex } from '../util';

/** The one scope a connector token carries: an ordering agent of its own sandbox kitchen, never an approver. */
export const SCOPE = 'agent';
/** MCP calls a minute with one connector access token. */
export const MCP_PER_TOKEN_PER_MINUTE = 60;
/** How long an access token lives, in seconds. */
const ACCESS_TTL_S = 3600;
/** How long a refresh token lives (the sandbox behind it usually ends sooner: 20 idle minutes or a demo reset). */
const REFRESH_TTL_MS = 24 * 3600_000;
/** How long a consent page and an authorization code stay usable. */
const STEP_TTL_MS = 10 * 60_000;
/** Registrations and consent pages a minute from one client address. */
const OAUTH_PER_ADDRESS_PER_MINUTE = 30;
/** The largest client ID metadata document the door reads. */
const CIMD_MAX_BYTES = 5000;
/** The consent cookie: the double-submit CSRF value, sent back only from the door's own pages (SameSite=Strict). */
const CSRF_COOKIE = 'lz_oauth';
/** Token replies are never cached. */
const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

/** A client the door accepts: registered here, or described by its own https metadata document. */
interface Client {
  clientId: string;
  name: string;
  redirectUris: string[];
}

/** 32 random bytes as base64url: codes, tokens, consent request ids and CSRF values. */
const secret = () => b64u(crypto.getRandomValues(new Uint8Array(32)));
/** The client address Cloudflare reports. */
const addressOf = (c: Context) => c.req.header('CF-Connecting-IP') ?? 'unknown';
/** The PKCE S256 challenge of a verifier. */
const s256 = async (verifier: string) => b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));

/** True for a redirect URI a public client may use: https, or http on a loopback host (native apps); no fragment, no user info. */
export function redirectAllowed(uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.length > 500 || uri.includes('#')) return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
}

/** True when a resource indicator (RFC 8707) names this door's MCP endpoint or the door itself. */
const ourResource = (origin: string, resource: string) => [origin, `${origin}/mcp`].includes(resource.replace(/\/$/, ''));

/** The redirect URI with the given query parameters added (its own query kept). */
function withParams(uri: string, params: Record<string, string>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/** The challenge `/mcp` answers a missing or dead token with (RFC 9728 §5.1): where the protected-resource metadata is. */
export function challenge(origin: string, tokenSent: boolean): string {
  return `Bearer ${tokenSent ? 'error="invalid_token", ' : ''}resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="${SCOPE}"`;
}

/**
 * The sandbox buyer behind a live connector access token, marking that sandbox used now (so it idles like a Try it sandbox);
 * null for an unknown, expired or refresh token, or when the sandbox is gone (evicted, recycled or reset).
 */
export async function oauthCaller(env: Env, header: string | undefined): Promise<{ buyerId: string; tokenHash: string } | null> {
  const token = bearerOf(header);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await db(env)
    .prepare("UPDATE try_visitors v SET last_used = ?2::bigint FROM oauth_tokens t WHERE t.token_hash = ?1::text AND t.kind = 'access' AND t.expires_ms > ?2::bigint AND v.buyer_id = t.buyer_id RETURNING v.buyer_id")
    .bind(tokenHash, Date.now())
    .first<{ buyer_id: string }>();
  return row ? { buyerId: row.buyer_id, tokenHash } : null;
}

/**
 * Reads a client ID metadata document: an https URL with a path, fetched without redirects, at most 5 KB and 3 s. Its
 * `client_id` must equal the URL exactly; only its https and loopback redirect URIs count. Anything else is null.
 */
async function metadataDocument(url: string, fetchFn: typeof fetch): Promise<Client | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hash || u.username || u.password || u.pathname === '/') return null;
  try {
    const res = await fetchFn(url, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(3000) });
    if (res.status !== 200 || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      size += r.value.byteLength;
      if (size > CIMD_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(r.value);
    }
    const bytes = new Uint8Array(size);
    chunks.reduce((at, ch) => (bytes.set(ch, at), at + ch.byteLength), 0);
    const doc = JSON.parse(new TextDecoder().decode(bytes)) as { client_id?: unknown; client_name?: unknown; redirect_uris?: unknown };
    if (doc?.client_id !== url || !Array.isArray(doc.redirect_uris)) return null;
    const name = typeof doc.client_name === 'string' && doc.client_name.trim() ? doc.client_name.trim().slice(0, 100) : u.host;
    return { clientId: url, name, redirectUris: doc.redirect_uris.filter(redirectAllowed) };
  } catch {
    return null;
  }
}

/** The client behind a client_id: an https one by its metadata document, any other from the registrations; null when unknown. */
async function clientOf(env: Env, clientId: string, fetchFn: typeof fetch): Promise<Client | null> {
  if (clientId.startsWith('https://')) return metadataDocument(clientId, fetchFn);
  const row = await db(env).prepare('SELECT client_name, redirect_uris FROM oauth_clients WHERE client_id = ?').bind(clientId).first<{ client_name: string; redirect_uris: string }>();
  return row ? { clientId, name: row.client_name, redirectUris: JSON.parse(row.redirect_uris) as string[] } : null;
}

/** An HTML reply that no other site may frame, no cache keeps and no Referer carries away; `formTo` adds a form-action origin. */
function secureHtml(c: Context, html: string, status: 200 | 400 | 403, formTo?: string) {
  c.header('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'${formTo ? ` ${formTo}` : ''}`);
  c.header('X-Frame-Options', 'DENY');
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  return c.html(html, status);
}

/** A refusal page; it never redirects, so a bad client or redirect URI never receives anything. */
const refusal = (c: Context, status: 400 | 403, title: string, text: string) => secureHtml(c, page(`Lazydoor – ${title}`, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>`), status);

/** Whole euros from cents, with thousands separators. */
const euros = (cents: number) => `${(cents / 100).toLocaleString('en')} €`;

/** The consent page: who asks, where the answer goes, what the sandbox kitchen's limits are, and Allow / Cancel. */
function consentPage(client: Client, redirectUri: string, request: string, csrf: string): string {
  const m = SANDBOX_MANDATE;
  return page(
    'Lazydoor – connect an agent',
    `<h1>Connect ${escapeHtml(client.name)} to Lazydoor</h1>
<p><b>${escapeHtml(client.name)}</b> asks to order as the chef of a new sandbox kitchen. After you allow, you go back to <b>${escapeHtml(new URL(redirectUri).host)}</b>.</p>
<div class="card"><b>The kitchen's signed limits</b><br>Up to ${euros(m.perOrder.autoCents)} an order and ${euros(m.perDay.autoCents)} a day go through on their own.<br>Above that the order is HELD for you to approve; over ${euros(m.perOrder.hardCents)} an order or ${euros(m.perDay.hardCents)} a day it is rejected.</div>
<div class="card">The agent can quote and order, and can never approve. You are the kitchen manager: your kitchen link, shown on the next page and never to the agent, is where held orders wait for you.</div>
<p class="muted">A sandbox with its own stock; nothing is delivered. It ends after ${SANDBOX_IDLE_MS / 60_000} idle minutes or at a demo reset, and then the agent's access ends with it.</p>
<form method="post" action="/oauth/authorize"><input type="hidden" name="request" value="${escapeHtml(request)}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<button name="decision" value="allow">Allow</button><button class="no" name="decision" value="deny">Cancel</button></form>`,
  );
}

/** The page after Allow: the kitchen link (the approver's own inbox) and the link back to the client with the code. */
function kitchenPage(name: string, kitchen: string, back: string): string {
  return page(
    'Lazydoor – your kitchen is ready',
    `<h1>Your kitchen is ready</h1>
<div class="card"><b>Your kitchen</b>: orders over the limits wait here for you to approve. Open it in a new tab and keep it; it is yours alone and ${escapeHtml(name)} never sees it.<br><a href="${escapeHtml(kitchen)}" target="_blank" rel="noopener noreferrer">Open your kitchen</a></div>
<p><a href="${escapeHtml(back)}">Continue to ${escapeHtml(name)}</a></p>`,
  );
}

/**
 * Issues a fresh access token (1 hour) and refresh token (24 hours) for a sandbox that still exists, storing only their
 * sha256; a sandbox that is gone is `invalid_grant`.
 */
async function issue(c: Context<{ Bindings: Env }>, clientId: string, buyerId: string) {
  const s = db(c.env);
  if (!(await s.prepare('SELECT 1 AS one FROM try_visitors WHERE buyer_id = ?').bind(buyerId).first())) {
    return c.json({ error: 'invalid_grant', error_description: 'the sandbox kitchen has ended: connect again' }, 400, NO_STORE);
  }
  const [access, refresh] = [secret(), secret()];
  const insert = 'INSERT INTO oauth_tokens(token_hash, kind, client_id, buyer_id, expires_ms) VALUES (?1::text, ?2::text, ?3::text, ?4::text, ?5::bigint)';
  await s.batch([
    s.prepare(insert).bind(await sha256Hex(access), 'access', clientId, buyerId, Date.now() + ACCESS_TTL_S * 1000),
    s.prepare(insert).bind(await sha256Hex(refresh), 'refresh', clientId, buyerId, Date.now() + REFRESH_TTL_MS),
  ]);
  return c.json({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE }, 200, NO_STORE);
}

/** The token request's fields: a form (the standard) or JSON, as strings; anything else is dropped. */
async function fieldsOf(c: Context): Promise<Record<string, string>> {
  const raw = (c.req.header('Content-Type') ?? '').includes('application/json') ? await c.req.json().catch(() => ({})) : await c.req.parseBody().catch(() => ({}));
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
}

/**
 * The connector: a small OAuth 2.1 authorization server for MCP clients such as Claude (feature flag `connector`, else every
 * route here is 404). Protected-resource (RFC 9728) and authorization-server (RFC 8414) metadata; dynamic client registration
 * (RFC 7591) and client ID metadata documents; the authorization code flow with PKCE S256 only; a consent page that opens a
 * sandbox kitchen with the Try it mandate and the person as its approver; tokens bound to that sandbox, stored as sha256.
 */
export function oauthRoutes(fetchFn: typeof fetch = fetch): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  const on: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
    if (!(await featureOn(c.env, 'connector'))) throw new HttpError(404, 'NOT_FOUND', 'no such route');
    await next();
  };
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/*', '/.well-known/oauth-authorization-server', '/oauth/*']) app.use(path, on);
  const open = cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization', 'MCP-Protocol-Version'] });
  for (const path of ['/.well-known/*', '/oauth/register', '/oauth/token']) app.use(path, open);
  const small = bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'invalid_request', error_description: 'at most 4 KB' }, 413) });
  const perAddress = (c: Context<{ Bindings: Env }>) => limit(c.env, `oauth-address:${addressBucket(addressOf(c))}`, OAUTH_PER_ADDRESS_PER_MINUTE, `at most ${OAUTH_PER_ADDRESS_PER_MINUTE} registrations and sign-ins a minute from one address`);

  /** Protected-resource metadata of `/mcp`, at the root and at the path-suffixed well-known URL. */
  const resource = (c: Context) => {
    const origin = new URL(c.req.url).origin;
    return c.json({ resource: `${origin}/mcp`, authorization_servers: [origin], bearer_methods_supported: ['header'], scopes_supported: [SCOPE], resource_name: 'Lazydoor', resource_documentation: `${origin}/.well-known/agent-gateway.json` });
  };
  app.get('/.well-known/oauth-protected-resource', resource);
  app.get('/.well-known/oauth-protected-resource/mcp', resource);

  app.get('/.well-known/oauth-authorization-server', (c) => {
    const origin = new URL(c.req.url).origin;
    return c.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      scopes_supported: [SCOPE],
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      service_documentation: `${origin}/.well-known/agent-gateway.json`,
    });
  });

  /** Dynamic client registration: public clients only (no secret), https or loopback redirect URIs, at most 5. */
  app.post('/oauth/register', small, async (c) => {
    await perAddress(c);
    const b = (await c.req.json().catch(() => null)) as { client_name?: unknown; redirect_uris?: unknown } | null;
    const uris = b?.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > 5 || !uris.every(redirectAllowed)) {
      return c.json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris: 1 to 5 https (or loopback http) URIs without a fragment' }, 400);
    }
    const name = typeof b?.client_name === 'string' && b.client_name.trim() ? b.client_name.trim().slice(0, 100) : 'MCP client';
    const clientId = `lzc_${b64u(crypto.getRandomValues(new Uint8Array(16)))}`;
    const issuedAt = Math.floor(Date.now() / 1000);
    await db(c.env).prepare('INSERT INTO oauth_clients(client_id, client_name, redirect_uris, created_at) VALUES (?,?,?,?)').bind(clientId, name, JSON.stringify(uris), new Date().toISOString()).run();
    return c.json({ client_id: clientId, client_id_issued_at: issuedAt, client_name: name, redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: SCOPE }, 201);
  });

  /**
   * The authorization request. A bad client or redirect URI gets a plain 400 page and no redirect; with both good, every
   * other error goes back to the redirect URI (with state and iss). A good request is stored for 10 minutes and shown as
   * the consent page, with its CSRF value both in the form and in an HttpOnly SameSite=Strict cookie.
   */
  app.get('/oauth/authorize', async (c) => {
    await perAddress(c);
    const q = c.req.query();
    const origin = new URL(c.req.url).origin;
    const client = q.client_id ? await clientOf(c.env, q.client_id, fetchFn) : null;
    if (!client) return refusal(c, 400, 'Unknown app', 'This app is not registered with the door. Start again from the app.');
    if (!redirectAllowed(q.redirect_uri) || !client.redirectUris.includes(q.redirect_uri)) return refusal(c, 400, 'Wrong return address', 'This return address is not registered for this app.');
    const back = (error: string) => c.redirect(withParams(q.redirect_uri, { error, ...(q.state ? { state: q.state } : {}), iss: origin }), 302);
    if (q.response_type !== 'code') return back('unsupported_response_type');
    if (q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge ?? '') || (q.state ?? '').length > 500) return back('invalid_request');
    if (q.resource && !ourResource(origin, q.resource)) return back('invalid_target');
    const [request, csrf] = [secret(), secret()];
    await db(c.env)
      .prepare('INSERT INTO oauth_requests(id_hash, csrf_hash, client_id, client_name, redirect_uri, code_challenge, state, expires_ms) VALUES (?1::text, ?2::text, ?3::text, ?4::text, ?5::text, ?6::text, ?7::text, ?8::bigint)')
      .bind(await sha256Hex(request), await sha256Hex(csrf), client.clientId, client.name, q.redirect_uri, q.code_challenge, q.state ?? null, Date.now() + STEP_TTL_MS)
      .run();
    c.header('Set-Cookie', `${CSRF_COOKIE}=${csrf}; Path=/oauth; HttpOnly; Secure; SameSite=Strict; Max-Age=${STEP_TTL_MS / 1000}`);
    return secureHtml(c, consentPage(client, q.redirect_uri, request, csrf), 200, new URL(q.redirect_uri).origin);
  });

  /**
   * The consent answer. The cookie must equal the form's CSRF value (constant time) and the stored request must carry its
   * hash; the request is then deleted, so it works once. Cancel goes back with access_denied. Allow opens a sandbox kitchen
   * (the Try it mandate, the person as approver), an approver key for it and a 10-minute code, and shows the kitchen link
   * (on this page only) beside the link back to the client.
   */
  app.post('/oauth/authorize', small, async (c) => {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const [request, csrf, decision] = ['request', 'csrf', 'decision'].map((k) => (typeof form[k] === 'string' ? (form[k] as string) : ''));
    const cookie = getCookie(c, CSRF_COOKIE) ?? '';
    if (!request || !csrf || !cookie || !(await sameSecret(cookie, csrf))) return refusal(c, 403, 'Not allowed', 'This consent did not come from this browser. Start again from the app.');
    if (decision === 'allow') await limitAddress(c.env, addressOf(c));
    const row = await db(c.env)
      .prepare('DELETE FROM oauth_requests WHERE id_hash = ?1::text AND csrf_hash = ?2::text AND expires_ms > ?3::bigint RETURNING client_id, client_name, redirect_uri, code_challenge, state')
      .bind(await sha256Hex(request), await sha256Hex(csrf), Date.now())
      .first<{ client_id: string; client_name: string; redirect_uri: string; code_challenge: string; state: string | null }>();
    if (!row) return refusal(c, 403, 'Not allowed', 'This consent was already answered or has expired. Start again from the app.');
    c.header('Set-Cookie', `${CSRF_COOKIE}=; Path=/oauth; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    const origin = new URL(c.req.url).origin;
    const back = (params: Record<string, string>) => withParams(row.redirect_uri, { ...params, ...(row.state ? { state: row.state } : {}), iss: origin });
    if (decision !== 'allow') return c.redirect(back({ error: 'access_denied' }), 302);
    const { buyerId } = await openSandbox(c.env, addressOf(c));
    const [kitchen, code] = [newKey('ap'), secret()];
    const s = db(c.env);
    await s.batch([
      s.prepare('INSERT INTO approver_keys(key_hash, buyer_id, approver) VALUES (?,?,?)').bind(await sha256Hex(kitchen), buyerId, TRY_APPROVER),
      s.prepare('INSERT INTO oauth_codes(code_hash, client_id, redirect_uri, code_challenge, buyer_id, expires_ms) VALUES (?1::text, ?2::text, ?3::text, ?4::text, ?5::text, ?6::bigint)')
        .bind(await sha256Hex(code), row.client_id, row.redirect_uri, row.code_challenge, buyerId, Date.now() + STEP_TTL_MS),
    ]);
    return secureHtml(c, kitchenPage(row.client_name, `/approver/${kitchen}`, back({ code })), 200);
  });

  /**
   * The token endpoint (public clients). An authorization code is deleted on its first use, whatever follows, then must be
   * unexpired and match the client, the redirect URI and the PKCE verifier; a refresh token rotates (the old one is deleted).
   */
  app.post('/oauth/token', small, async (c) => {
    const f = await fieldsOf(c);
    const fail = (error: string, description: string) => c.json({ error, error_description: description }, 400, NO_STORE);
    const s = db(c.env);
    if (f.grant_type === 'authorization_code') {
      if (!f.code || !f.client_id || !f.redirect_uri || !f.code_verifier) return fail('invalid_request', 'code, client_id, redirect_uri and code_verifier are required');
      const row = await s
        .prepare('DELETE FROM oauth_codes WHERE code_hash = ?1::text RETURNING client_id, redirect_uri, code_challenge, buyer_id, expires_ms')
        .bind(await sha256Hex(f.code))
        .first<{ client_id: string; redirect_uri: string; code_challenge: string; buyer_id: string; expires_ms: number }>();
      const verifierOk = /^[A-Za-z0-9._~-]{43,128}$/.test(f.code_verifier) && row !== null && (await sameSecret(await s256(f.code_verifier), row.code_challenge));
      if (!row || row.expires_ms <= Date.now() || row.client_id !== f.client_id || row.redirect_uri !== f.redirect_uri || !verifierOk) return fail('invalid_grant', 'the code is unknown, used, expired, or not for this client, redirect URI or verifier');
      if (f.resource && !ourResource(new URL(c.req.url).origin, f.resource)) return fail('invalid_target', 'the resource is not this door');
      return issue(c, row.client_id, row.buyer_id);
    }
    if (f.grant_type === 'refresh_token') {
      if (!f.refresh_token || !f.client_id) return fail('invalid_request', 'refresh_token and client_id are required');
      const row = await s
        .prepare("DELETE FROM oauth_tokens WHERE token_hash = ?1::text AND kind = 'refresh' RETURNING client_id, buyer_id, expires_ms")
        .bind(await sha256Hex(f.refresh_token))
        .first<{ client_id: string; buyer_id: string; expires_ms: number }>();
      if (!row || row.expires_ms <= Date.now() || row.client_id !== f.client_id) return fail('invalid_grant', 'the refresh token is unknown, used, expired or not for this client');
      return issue(c, row.client_id, row.buyer_id);
    }
    return fail('unsupported_grant_type', 'authorization_code or refresh_token');
  });

  return app;
}
