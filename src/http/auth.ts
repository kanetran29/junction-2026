import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import { sha256Hex } from '../orders/store';

export type Role = 'agent' | 'judge' | 'admin';

/** Who a request is: the key's role and, for agent and judge keys, the buyer it belongs to (the admin key has none). */
export interface Caller {
  role: Role;
  buyerId: string | null;
}

/** A refusal that maps straight onto a status and the `{ error, detail }` body. */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 429,
    readonly code: string,
    message: string,
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
async function sameSecret(a: string, b: string): Promise<boolean> {
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
  const row = await env.DB.prepare('SELECT buyer_id, role FROM api_keys WHERE key_hash = ?').bind(await sha256Hex(token)).first<{ buyer_id: string; role: Role }>();
  return row ? { role: row.role, buyerId: row.buyer_id } : null;
}

/** The context key under which `authenticate` stores the resolved caller. */
const CALLER = 'caller';

/**
 * Structural auth for `/v1/*`: resolves the caller from the bearer key before any validation (no key or an unknown one is
 * 401) and keeps it in the request context for `requireBuyer`; the public `exempt` paths skip it.
 */
export function authenticate(exempt: string[]): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    if (!exempt.includes(c.req.path)) {
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
 * Counts one use of a key in the current minute (D1 counter keyed by key hash and wall-clock minute) and answers 429
 * once it exceeds `limit`; older minutes are swept in the same call so the table stays tiny.
 */
export async function rateLimit(env: Env, header: string | undefined, limit: number): Promise<void> {
  const keyHash = await sha256Hex(bearerOf(header) ?? '');
  const minute = Math.floor(Date.now() / 60_000);
  const [, bump] = await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limits WHERE minute < ?').bind(minute),
    env.DB.prepare('INSERT INTO rate_limits(key_hash, minute, n) VALUES (?, ?, 1) ON CONFLICT(key_hash, minute) DO UPDATE SET n = n + 1 RETURNING n').bind(keyHash, minute),
  ]);
  if ((bump.results[0] as { n: number }).n > limit) throw new HttpError(429, 'RATE_LIMITED', `at most ${limit} requests a minute for this key`);
}
