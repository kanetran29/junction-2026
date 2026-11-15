import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import { sha256Hex } from '../util';
import { db } from '../db';

export type Role = 'agent' | 'judge' | 'admin';

/** Who a request is: the key's role and, for agent and judge keys, the buyer it belongs to (the admin key has none). */
export interface Caller {
  role: Role;
  buyerId: string | null;
}

/** A refusal that maps straight onto a status and the `{ error, detail }` body (plus `retryAfter` seconds when given). */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 429 | 503,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** The bearer token of a request, or null when there is no `Authorization: Bearer` header. */
export function bearerOf(header: string | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return m ? m[1] : null;
}

/** Compares two secrets in constant time by comparing their fixed-length sha256 digests. */
/** A short public fingerprint of the caller's bearer key: `k_` and the first 12 hex characters of its sha256, never the key. */
export async function keyIdOf(header: string | undefined): Promise<string> {
  return `k_${(await sha256Hex(bearerOf(header) ?? '')).slice(0, 12)}`;
}

export async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(da, db);
}

/**
 * Resolves an Authorization header to a caller: the `ADMIN_KEY` secret (constant-time compare) is the admin; any other
 * token is looked up by its sha256 in `api_keys`. No header or an unknown key is null.
 */
export async function identify(env: Env, header: string | undefined): Promise<Caller | null> {
  const token = bearerOf(header);
  if (!token) return null;
  if (env.ADMIN_KEY && (await sameSecret(token, env.ADMIN_KEY))) return { role: 'admin', buyerId: null };
  const row = await db(env).prepare('SELECT buyer_id, role FROM api_keys WHERE key_hash = ?').bind(await sha256Hex(token)).first<{ buyer_id: string; role: Role }>();
  return row ? { role: row.role, buyerId: row.buyer_id } : null;
}

/**
 * True when the Authorization header carries an agent or judge key, or any connector (OAuth) token, live or not: such a caller
 * orders but can never approve or reject.
 */
export async function isAgentCaller(env: Env, header: string | undefined): Promise<boolean> {
  const who = await identify(env, header);
  if (who) return who.role === 'agent' || who.role === 'judge';
  const token = bearerOf(header);
  return Boolean(token && (await db(env).prepare('SELECT 1 AS one FROM oauth_tokens WHERE token_hash = ?').bind(await sha256Hex(token)).first()));
}

/** The context key under which `authenticate` stores the resolved caller. */
const CALLER = 'caller';

/**
 * A keyless read on a demo door: `DEMO_MODE=1` and no Authorization header at all. A header that is present but wrong is not
 * keyless, so a bad key stays 401 instead of falling back to the open read.
 */
export function keylessDemo(env: Env, header: string | undefined): boolean {
  return env.DEMO_MODE === '1' && header === undefined;
}

/**
 * Structural auth for `/v1/*`: resolves the caller from the bearer key before any validation (no key or an unknown one is
 * 401) and keeps it in the request context for `requireBuyer`; the public `exempt` paths skip it, and the `demoOpen` paths
 * skip it for a keyless request on a demo door (their handler then reads every buyer, read-only). A path matching
 * `visitorPath` also skips it, but only for a request that sends `X-Visitor-Token` and no Authorization header; its handler
 * then resolves the visitor's own sandbox and nothing else.
 */
export function authenticate(exempt: string[], demoOpen: string[], visitorPath?: RegExp): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const visitor = visitorPath?.test(c.req.path) === true && c.req.header('X-Visitor-Token') !== undefined && c.req.header('Authorization') === undefined;
    const open = exempt.includes(c.req.path) || visitor || (demoOpen.includes(c.req.path) && keylessDemo(c.env, c.req.header('Authorization')));
    if (!open) {
      const who = await identify(c.env, c.req.header('Authorization'));
      if (!who) throw new HttpError(401, 'UNAUTHORIZED', 'a valid Bearer API key is required');
      c.set(CALLER as never, who as never);
    }
    await next();
  };
}

/** The buyer behind an agent or judge key (from the context set by `authenticate`, else resolved here, as `/mcp` does); no key or an unknown one is 401, the buyerless admin key 403. */
export async function requireBuyer(c: Context<{ Bindings: Env }>): Promise<{ buyerId: string; role: Role }> {
  const who = (c.get(CALLER as never) as Caller | undefined) ?? (await identify(c.env, c.req.header('Authorization')));
  if (!who) throw new HttpError(401, 'UNAUTHORIZED', 'a valid Bearer API key is required');
  if (!who.buyerId) throw new HttpError(403, 'FORBIDDEN', 'the admin key has no buyer; use an agent or judge key');
  return { buyerId: who.buyerId, role: who.role };
}

/**
 * Counts one use of a bucket in the current wall-clock minute and returns the count so far (Postgres counter keyed by the
 * bucket's sha256, so an address or key is never stored as is); older minutes are swept in the same call so the table stays tiny.
 */
export async function countUse(env: Env, bucket: string): Promise<number> {
  const keyHash = await sha256Hex(bucket);
  const minute = Math.floor(Date.now() / 60_000);
  const s = db(env);
  const [, bump] = await s.batch([
    s.prepare('DELETE FROM rate_limits WHERE minute < ?').bind(minute),
    s.prepare('INSERT INTO rate_limits(key_hash, minute, n) VALUES (?, ?, 1) ON CONFLICT(key_hash, minute) DO UPDATE SET n = rate_limits.n + 1 RETURNING n').bind(keyHash, minute),
  ]);
  return (bump.results[0] as { n: number }).n;
}

/** Counts one use of a bearer key (`countUse`) and answers 429 RATE_LIMITED once it exceeds `limit` this minute. */
export async function rateLimit(env: Env, header: string | undefined, limit: number): Promise<void> {
  if ((await countUse(env, bearerOf(header) ?? '')) > limit) throw new HttpError(429, 'RATE_LIMITED', `at most ${limit} requests a minute for this key`);
}
