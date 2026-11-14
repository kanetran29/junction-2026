import { helsinkiIso, now } from '../clock';
import { db } from '../db';
import { DEFAULT_MANDATE_EXP, SANDBOX_BUYER_PREFIX } from '../domain/constants';
import { REASONS, type ReasonCode } from '../domain/reasons';
import type { Env } from '../env';
import { HttpError, countUse, identify } from '../http/auth';
import { confirmDraft, interpret, type InterpretedDraft } from '../interpret/gemini';
import { seedMandate } from '../mandate/jws';
import { approve, getOrder, placeOrder, reject, type OrderView } from '../orders/store';
import type { Offer, Rejection } from '../quote/build';
import { createQuote } from '../quote/store';
import { b64u, sha256Hex } from '../util';

/** Calls a minute from one client address (both Try it routes count). */
export const TRY_PER_ADDRESS_PER_MINUTE = 3;
/** `/v1/try` calls a minute from all visitors together: each one may call Gemini and Gemma, whose quota is small. */
export const TRY_ALL_PER_MINUTE = 12;
/** Sandbox kitchens open at once; `/admin/reset` ends them all. */
export const MAX_SANDBOXES = 50;
/** Open sandbox kitchens one client address may hold. */
export const SANDBOXES_PER_ADDRESS = 3;
/** A sandbox nobody used for this long is freed when a new one opens. */
export const SANDBOX_IDLE_MS = 30 * 60_000;
/** The approver every sandbox mandate names: the visitor is the kitchen manager of their own sandbox. */
export const TRY_APPROVER = 'You (kitchen manager)';
/** The reason the door gives on every Try it order, as an agent would. */
export const TRY_AGENT_REASON = 'Try it: cheapest covering offer';

/** A sandbox kitchen's signed rules: the demo kitchen's limits (500 € an order and 1,500 € a day automatically), the visitor as approver. */
const SANDBOX_MANDATE = { perOrder: { autoCents: 50_000, hardCents: 500_000 }, perDay: { autoCents: 150_000, hardCents: 1_000_000 }, approver: { name: TRY_APPROVER }, exp: DEFAULT_MANDATE_EXP };

/** A new request (`text`), or the answer to a question about a stored draft (`visitor`, `draftId`, `answer`). */
export interface TryRequest {
  text?: string;
  visitor?: string;
  draftId?: string;
  answer?: { field: 'deliverBy'; value: string };
}

/** One reason as Try it shows it: the code and a sentence (the decision's own detail, else the reason table's text). */
type ShownReason = { code: string; detail: string };

/** What `/v1/try` answers; see the contract in README "Try it". */
export interface TryReply {
  visitor: string;
  buyerId: string;
  step: 'needs_input' | 'no_offer' | 'decided';
  draft?: InterpretedDraft;
  question?: { field: string; readings: { model: string; value: unknown }[] };
  quote?: { quoteId: string; offers: Offer[]; rejections: Rejection[]; jws?: string };
  order?: { orderId: string; state: string; reasons: ShownReason[]; netCents: number; grossCents: number };
  approval?: { token: string; expiresAt: string };
}

/** Seconds until the current rate-limit minute ends (at least 1). */
const untilNextMinute = () => Math.max(1, 60 - Math.floor((Date.now() % 60_000) / 1000));

/**
 * The address a client is limited by: an IPv4 address as is, an IPv6 address by its /64 prefix (one subscriber usually holds
 * a whole /64, so per-address limits would otherwise be unlimited).
 */
export function addressBucket(ip: string): string {
  if (!ip.includes(':')) return ip;
  if (ip.includes('.')) return ip.slice(ip.lastIndexOf(':') + 1);
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map((g) => parseInt(g || '0', 16).toString(16)).join(':')}::/64`;
}

/** Counts one call from a client address: 3 a minute, else 429 TRY_RATE_LIMITED with the seconds to wait. */
async function limitAddress(env: Env, address: string): Promise<void> {
  if ((await countUse(env, `try-address:${addressBucket(address)}`)) > TRY_PER_ADDRESS_PER_MINUTE) {
    throw new HttpError(429, 'TRY_RATE_LIMITED', `at most ${TRY_PER_ADDRESS_PER_MINUTE} Try it calls a minute from one address`, untilNextMinute());
  }
}

/** Counts one call that is about to ask the models against all visitors: 12 a minute, else 429 TRY_RATE_LIMITED. */
async function limitShared(env: Env): Promise<void> {
  if ((await countUse(env, 'try-all')) > TRY_ALL_PER_MINUTE) {
    throw new HttpError(429, 'TRY_RATE_LIMITED', `Try it is busy: at most ${TRY_ALL_PER_MINUTE} calls a minute for all visitors together`, untilNextMinute());
  }
}

/** Removes a sandbox kitchen: its visitor row, signed mandate and buyer key (orders and events stay). */
async function closeSandbox(env: Env, buyerId: string): Promise<void> {
  const s = db(env);
  await s.batch(['try_visitors', 'mandates', 'buyer_keys'].map((t) => s.prepare(`DELETE FROM ${t} WHERE buyer_id = ?`).bind(buyerId)));
}

/**
 * Opens a sandbox kitchen: a random `visitor-<8 hex>` buyer with the sandbox mandate (seeded first, so a reset racing this
 * leaves a sandbox that can order nothing), and a visitor token of 24 random bytes of which only the sha256 is stored. In one
 * batch under the write lock it frees sandboxes idle for 30 minutes, then inserts only while fewer than 50 are open and the
 * client address holds fewer than 3; a refused open removes its mandate again and is 429 TRY_SANDBOXES_FULL.
 */
async function openSandbox(env: Env, address: string): Promise<{ visitor: string; buyerId: string }> {
  const visitor = b64u(crypto.getRandomValues(new Uint8Array(24)));
  const buyerId = `${SANDBOX_BUYER_PREFIX}${[...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  const addressHash = await sha256Hex(`try-address:${addressBucket(address)}`);
  const idle = Date.now() - SANDBOX_IDLE_MS;
  await seedMandate(env, buyerId, SANDBOX_MANDATE);
  const s = db(env);
  const stale = 'SELECT buyer_id FROM try_visitors WHERE COALESCE(last_used, 0) < ?1::bigint';
  const [, , , ins, mine] = await s.batch([
    s.prepare(`DELETE FROM mandates WHERE buyer_id IN (${stale})`).bind(idle),
    s.prepare(`DELETE FROM buyer_keys WHERE buyer_id IN (${stale})`).bind(idle),
    s.prepare('DELETE FROM try_visitors WHERE COALESCE(last_used, 0) < ?1::bigint').bind(idle),
    s.prepare(
      `INSERT INTO try_visitors(token_hash, buyer_id, address_hash, created_at, last_used) SELECT ?1::text, ?2::text, ?3::text, ?4::text, ?5::bigint
       WHERE (SELECT COUNT(*) FROM try_visitors) < ${MAX_SANDBOXES} AND (SELECT COUNT(*) FROM try_visitors WHERE address_hash = ?3::text) < ${SANDBOXES_PER_ADDRESS}`,
    ).bind(await sha256Hex(visitor), buyerId, addressHash, helsinkiIso(await now(env)), Date.now()),
    s.prepare('SELECT COUNT(*) AS n FROM try_visitors WHERE address_hash = ?1::text').bind(addressHash),
  ]);
  if (!ins.meta.changes) {
    await closeSandbox(env, buyerId);
    const perAddress = (mine.results[0] as { n: number }).n >= SANDBOXES_PER_ADDRESS;
    throw new HttpError(
      429,
      'TRY_SANDBOXES_FULL',
      perAddress ? `this address already holds ${SANDBOXES_PER_ADDRESS} open sandbox kitchens: keep using your visitor token` : `all ${MAX_SANDBOXES} sandbox kitchens are in use; one frees after ${SANDBOX_IDLE_MS / 60_000} idle minutes or at the next demo reset`,
    );
  }
  return { visitor, buyerId };
}

/** The sandbox buyer of a visitor token (and marks it used now); an unknown one (ended by a reset or idle) is 404 VISITOR_UNKNOWN. */
async function sandboxOf(env: Env, visitor: string): Promise<string> {
  const row = await db(env).prepare('UPDATE try_visitors SET last_used = ?2::bigint WHERE token_hash = ?1 RETURNING buyer_id').bind(await sha256Hex(visitor), Date.now()).first<{ buyer_id: string }>();
  if (!row) throw new HttpError(404, 'VISITOR_UNKNOWN', 'no such visitor: sandboxes end at a demo reset or after 30 idle minutes, so start again without one');
  return row.buyer_id;
}

/** The sandbox's own stored draft, or 404 DRAFT_NOT_FOUND. */
async function storedDraft(env: Env, buyerId: string, draftId: string): Promise<InterpretedDraft> {
  const row = await db(env).prepare('SELECT body FROM drafts WHERE id = ? AND buyer_id = ?').bind(draftId, buyerId).first<{ body: string }>();
  if (!row) throw new HttpError(404, 'DRAFT_NOT_FOUND', `no draft ${draftId} in this sandbox`);
  return JSON.parse(row.body) as InterpretedDraft;
}

/** An order's reasons for the visitor: why it ended (when it did), then the decision's reasons, each with a sentence. */
function reasonsOf(v: OrderView): ShownReason[] {
  const text = (code: string) => REASONS[code as ReasonCode]?.text ?? code;
  const ended = v.reason ? [{ code: v.reason, detail: text(v.reason) }] : [];
  return [...ended, ...v.decision.reasons.filter((r) => r.code !== v.reason).map((r) => ({ code: r.code, detail: r.detail ?? text(r.code) }))];
}

/**
 * Runs one Try it step for a visitor, server-side, the way the reference agent orders but with no model choosing anything:
 * opens a sandbox on the first call; interprets the text (Gemini, with Gemma's independent reading) or loads the draft the
 * visitor is answering; fills the agent's profile default (fat level "any") and the answer; stops with `needs_input` and a
 * question while any field is still open; otherwise confirms, quotes and places offer 0 (the cheapest covering offer) with
 * its JWS and a fresh idempotency key. A HELD order comes back with its approval token, because the visitor is the approver
 * of this sandbox and of nothing else.
 */
export async function tryIt(env: Env, req: TryRequest, address: string, fetchFn: typeof fetch): Promise<TryReply> {
  await limitAddress(env, address);
  const known = req.visitor ? await sandboxOf(env, req.visitor) : null;
  if (!req.draftId) await limitShared(env);
  const { visitor, buyerId } = req.visitor && known ? { visitor: req.visitor, buyerId: known } : await openSandbox(env, address);
  try {
    return await step(env, req, visitor, buyerId, fetchFn);
  } catch (err) {
    // the visitor never got the token of a sandbox whose first call failed, so free its slot
    if (!known) await closeSandbox(env, buyerId);
    throw err;
  }
}

/** The steps of `tryIt` after the sandbox is known: interpret or load the draft, ask, confirm, quote, place. */
async function step(env: Env, req: TryRequest, visitor: string, buyerId: string, fetchFn: typeof fetch): Promise<TryReply> {
  const draft = req.draftId ? await storedDraft(env, buyerId, req.draftId) : await interpret(env, { buyerId, text: req.text! }, { fetch: fetchFn });
  const fill: Record<string, unknown> = { ...(draft.unclear.includes('fatLevel') ? { fatLevel: 'any' } : {}), ...(req.answer ? { [req.answer.field]: req.answer.value } : {}) };
  const open = [...new Set([...(draft.status === 'needs_input' ? draft.missing : []), ...draft.unclear])].filter((f) => !Object.hasOwn(fill, f));
  if (open.length) {
    const readings = draft.disagreement?.find((d) => d.field === open[0])?.readings ?? [];
    return { visitor, buyerId, step: 'needs_input', draft, question: { field: open[0], readings } };
  }
  const confirmed = await confirmDraft(env, { draftId: draft.id, fill, buyerId });
  const q = await createQuote(env, buyerId, { draftId: confirmed.id }, fetchFn);
  const best = q.offers[0];
  const quote = { quoteId: q.id, offers: q.offers, rejections: q.rejections, ...(best?.jws ? { jws: best.jws } : {}) };
  if (!best) return { visitor, buyerId, step: 'no_offer', draft: confirmed, quote };
  const placed = await placeOrder(env, { buyerId, quoteId: q.id, offerId: best.offerId, quoteJws: best.jws, idempotencyKey: crypto.randomUUID(), agentReason: TRY_AGENT_REASON }, fetchFn);
  const order = { orderId: placed.orderId, state: placed.state, reasons: reasonsOf(placed), netCents: placed.order.netCents, grossCents: placed.order.grossCents };
  if (placed.state !== 'HELD') return { visitor, buyerId, step: 'decided', draft: confirmed, quote, order };
  const held = await db(env).prepare("SELECT approval_token, expires_at FROM orders WHERE id = ? AND buyer_id = ? AND state = 'HELD'").bind(placed.orderId, buyerId).first<{ approval_token: string; expires_at: string }>();
  return { visitor, buyerId, step: 'decided', draft: confirmed, quote, order, ...(held ? { approval: { token: held.approval_token, expiresAt: held.expires_at } } : {}) };
}

/**
 * The visitor decides a HELD order of their own sandbox through the normal approval path (re-check included: the cut-off,
 * Valio's stock and price, the token's lines binding). An agent or judge key is 403 AGENT_CANNOT_APPROVE; a token that is not
 * on one of this sandbox's orders is 404 TOKEN_UNKNOWN, whoever's order it is.
 */
export async function tryDecision(
  env: Env,
  req: { visitor: string; token: string; decision: 'approve' | 'reject' },
  ctx: { address: string; authorization: string | undefined },
  fetchFn: typeof fetch,
): Promise<{ order: { orderId: string; state: string; reasons: ShownReason[] } }> {
  const who = await identify(env, ctx.authorization);
  if (who?.role === 'agent' || who?.role === 'judge') throw new HttpError(403, 'AGENT_CANNOT_APPROVE', 'an agent key can never approve or reject an order');
  await limitAddress(env, ctx.address);
  const buyerId = await sandboxOf(env, req.visitor);
  const row = await db(env).prepare('SELECT id FROM orders WHERE approval_token = ? AND buyer_id = ?').bind(req.token, buyerId).first<{ id: string }>();
  if (!row) throw new HttpError(404, 'TOKEN_UNKNOWN', 'no order of this sandbox kitchen has this approval token');
  if (req.decision === 'approve') await approve(env, req.token, { callerRole: 'approver' }, fetchFn);
  else await reject(env, req.token, { callerRole: 'approver' });
  const v = (await getOrder(env, buyerId, row.id))!;
  return { order: { orderId: v.orderId, state: v.state, reasons: reasonsOf(v) } };
}
