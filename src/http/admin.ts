import { Hono } from 'hono';
import { z } from 'zod';
import { helsinkiIso, normaliseClock, now, setClock } from '../clock';
import { DEFAULT_MANDATE_EXP } from '../domain/constants';
import type { Env } from '../env';
import { EVENT_LOCK, logEvent } from '../events/log';
import { seedMandate } from '../mandate/jws';
import { newId, sha256Hex } from '../util';
import { HttpError, identify } from './auth';
import { db, ensureSchema } from '../db';

const BUYERS = ['hotel-a', 'hotel-b'] as const;
const DEFAULT_DELIVERY = '2026-11-16';
const euros = z.object({ auto: z.number().nonnegative(), hard: z.number().nonnegative() });

const ResetBody = z.object({
  clock: z.string().nullish(),
  replay: z.string().nullish(),
  replayVariant: z.record(z.string(), z.string()).nullish(),
  mandate: z.object({ perOrder: euros, perDay: euros, reliabilityFloor: z.number().min(0).max(1), approver: z.string().min(1), reliabilityUnknown: z.enum(['allow', 'approve']).optional() }).partial().nullish(),
  mandateTampered: z.boolean().nullish(),
  mandateExp: z.string().nullish(),
  tryIt: z.boolean().nullish(),
  priorAcceptedNetCents: z.number().int().nonnegative().nullish(),
  priorAccepted: z.array(z.object({ buyer: z.string(), productId: z.string(), salesUnits: z.number().positive() })).nullish(),
});

/** A random API key with a readable prefix (`ld_` agent, `ap_` approver, `jd_` judge); only its sha256 is stored. */
function newKey(prefix: string): string {
  return `${prefix}_${[...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Euros as whole cents (the case file writes limits in euros). */
const cents = (eur: number) => Math.round(eur * 100);

/** Stores a settings row, or removes it when `value` is null. */
async function setSetting(env: Env, key: string, value: string | null): Promise<void> {
  if (value === null) await db(env).prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
  else await db(env).prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}

/** Appends a settled ACCEPTED order (for the day total and the ledger) that the case file says exists already. */
async function insertPriorOrder(env: Env, buyerId: string, netCents: number, line?: { productId: string; salesUnits: number }): Promise<void> {
  const id = newId('ord_prior');
  const body = JSON.stringify({ lines: [], unmet: [] });
  const s = db(env);
  const stmts = [
    s.prepare("INSERT INTO orders(id, buyer_id, state, net_cents, gross_cents, delivery_date, body, created_at) VALUES (?,?,'ACCEPTED',?,?,?,?,?)").bind(id, buyerId, netCents, netCents, DEFAULT_DELIVERY, body, helsinkiIso(await now(env))),
  ];
  if (line) stmts.push(s.prepare("INSERT INTO order_lines(order_id, buyer_id, product_id, delivery_date, sales_units, state) VALUES (?,?,?,?,?,'ACCEPTED')").bind(id, buyerId, line.productId, DEFAULT_DELIVERY, line.salesUnits));
  await s.batch(stmts);
}

/**
 * Demo-only admin routes (the acceptance runner and the demo operator): reset, clock, replay variant, the audit tamper demo
 * and the order and ledger counters. Every route needs `DEMO_MODE=1` (else 404, as if absent) and the admin key (else 401). `saveMandate`
 * and `seedMandate` are reachable only from here and from scripts, never from a buyer route.
 */
export function adminRoutes(): Hono<{ Bindings: Env }> {
  const admin = new Hono<{ Bindings: Env }>();

  /** Gate for every admin route: demo mode only (else 404, as if absent), then the admin key (else 401). */
  admin.use('/admin/*', async (c, next) => {
    if (c.env.DEMO_MODE !== '1') throw new HttpError(404, 'NOT_FOUND', 'no such route');
    const who = await identify(c.env, c.req.header('Authorization'));
    if (who?.role !== 'admin') throw new HttpError(401, 'UNAUTHORIZED', 'the admin key is required');
    await next();
  });

  /**
   * Returns the gateway to a case's starting state: wipes drafts, quotes, baskets, orders, lines, events, approver keys
   * and agent API keys (judge keys survive), mandates and buyer keys (so a v1 mandate can be seeded again), applies the clock, replay recording and variants,
   * seeds both buyers' signed mandates from the given euro limits, books the prior accepted orders and mints fresh keys.
   */
  admin.post('/admin/reset', async (c) => {
    const parsed = ResetBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw parsed.error;
    const b = parsed.data;
    const env = c.env;
    if (b.clock != null) {
      try {
        normaliseClock(b.clock);
      } catch (err) {
        throw new HttpError(400, 'INVALID_REQUEST', (err as Error).message);
      }
    }
    await ensureSchema(env);
    const s = db(env);
    // the event lock too, so an event being appended right now cannot land on top of the wiped chain
    await s.batch([s.prepare(`SELECT pg_advisory_xact_lock(${EVENT_LOCK})`), ...['order_lines', 'orders', 'quotes', 'baskets', 'drafts', 'events', 'approver_keys', 'rate_limits', 'try_visitors', 'mandates', 'buyer_keys'].map((t) => s.prepare(`DELETE FROM ${t}`)), s.prepare("DELETE FROM api_keys WHERE role <> 'judge'")]);
    await setClock(env, b.clock ?? null);
    await setSetting(env, 'replay', b.replay ? '1' : null);
    await setSetting(env, 'recording', b.replay ?? null);
    await setSetting(env, 'variants', JSON.stringify(b.replayVariant ?? {}));
    await setSetting(env, 'try_off', b.tryIt === false ? '1' : null);

    const m = b.mandate ?? {};
    const overrides = {
      ...(m.perOrder ? { perOrder: { autoCents: cents(m.perOrder.auto), hardCents: cents(m.perOrder.hard) } } : {}),
      ...(m.perDay ? { perDay: { autoCents: cents(m.perDay.auto), hardCents: cents(m.perDay.hard) } } : {}),
      ...(m.reliabilityFloor !== undefined ? { reliabilityFloor: m.reliabilityFloor } : {}),
      ...(m.reliabilityUnknown ? { reliabilityUnknown: m.reliabilityUnknown } : {}),
      ...(m.approver ? { approver: { name: m.approver } } : {}),
      exp: b.mandateExp ?? DEFAULT_MANDATE_EXP,
    };
    for (const buyer of BUYERS) await seedMandate(env, buyer, overrides, { tamper: Boolean(b.mandateTampered) && buyer === 'hotel-a' });

    if (b.priorAcceptedNetCents != null) await insertPriorOrder(env, 'hotel-a', b.priorAcceptedNetCents);
    for (const p of b.priorAccepted ?? []) await insertPriorOrder(env, p.buyer, 0, p);

    const agentKeys: Record<string, string> = {};
    const approverKeys: Record<string, string> = {};
    for (const buyer of BUYERS) {
      agentKeys[buyer] = newKey('ld');
      approverKeys[buyer] = newKey('ap');
      await s.batch([
        s.prepare("INSERT INTO api_keys(key_hash, buyer_id, label, role) VALUES (?,?,'demo agent','agent')").bind(await sha256Hex(agentKeys[buyer]), buyer),
        s.prepare('INSERT INTO approver_keys(key_hash, buyer_id, approver) VALUES (?,?,?)').bind(await sha256Hex(approverKeys[buyer]), buyer, m.approver ?? 'Kitchen manager'),
      ]);
    }
    await logEvent(env, { buyerId: 'admin', type: 'clock.set', data: { now: helsinkiIso(await now(env)) } });
    return c.json({ agentKeys, approverKeys });
  });

  /**
   * Demo of the audit chain: rewrites one event's data (the given `seq`, else the latest event) by adding `"tampered": true`,
   * leaving its stored hashes alone, so `/v1/audit/verify` answers `valid: false` with that seq. `/admin/reset` starts a
   * fresh chain. An unknown seq is 404.
   */
  admin.post('/admin/tamper', async (c) => {
    const parsed = z.object({ seq: z.number().int().positive().optional() }).safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw parsed.error;
    const row = await db(c.env)
      .prepare(`UPDATE events SET body = (body::jsonb || '{"tampered": true}'::jsonb)::text WHERE id = COALESCE(?1::bigint, (SELECT MAX(id) FROM events)) RETURNING id`)
      .bind(parsed.data.seq ?? null)
      .first<{ id: number }>();
    if (!row) throw new HttpError(404, 'EVENT_NOT_FOUND', 'no such event');
    return c.json({ tampered: row.id });
  });

  /** Opens `/demo` before its open time (or hides it again until then); kept across resets. */
  admin.post('/admin/demo-open', async (c) => {
    const parsed = z.object({ open: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw parsed.error;
    await setSetting(c.env, 'demo_open', parsed.data.open ? '1' : null);
    return c.json({ demoOpen: parsed.data.open });
  });

  /** Switches Try it on or off at once (off: both Try it routes answer 404, so the demo page hides the panel); a reset switches it on. */
  admin.post('/admin/try', async (c) => {
    const parsed = z.object({ enabled: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw parsed.error;
    await setSetting(c.env, 'try_off', parsed.data.enabled ? null : '1');
    return c.json({ tryIt: parsed.data.enabled });
  });

  /**
   * Mints a judge key: it places orders as `hotel-b` and reads every buyer's events. Returned once (only its sha256 is
   * stored) and kept across `/admin/reset`, so the key handed to a judge keeps working.
   */
  admin.post('/admin/judge-key', async (c) => {
    const key = newKey('jd');
    await ensureSchema(c.env);
    await db(c.env).prepare("INSERT INTO api_keys(key_hash, buyer_id, label, role) VALUES (?,?,'judge','judge')").bind(await sha256Hex(key), 'hotel-b').run();
    return c.json({ key, buyer: 'hotel-b', role: 'judge' }, 201);
  });

  /** Sets (ISO with offset) or clears (null) the demo clock and logs `clock.set`. */
  admin.post('/admin/clock', async (c) => {
    const parsed = z.object({ clock: z.string().nullable() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw parsed.error;
    try {
      await setClock(c.env, parsed.data.clock);
    } catch (err) {
      return c.json({ error: 'INVALID_REQUEST', detail: (err as Error).message }, 400);
    }
    const at = helsinkiIso(await now(c.env));
    await logEvent(c.env, { buyerId: 'admin', type: 'clock.set', data: { now: at } });
    return c.json({ ok: true, now: at });
  });

  /** Replaces the replay variant map (`{ productId: 'out_of_stock' | 'price_plus_10pct' }`); an optional `recording` switches replay on with that recording. */
  admin.post('/admin/replay', async (c) => {
    const parsed = z.object({ variant: z.record(z.string(), z.string()), recording: z.string().optional() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw parsed.error;
    await setSetting(c.env, 'variants', JSON.stringify(parsed.data.variant));
    if (parsed.data.recording) {
      await setSetting(c.env, 'recording', parsed.data.recording);
      await setSetting(c.env, 'replay', '1');
    }
    return c.json({ ok: true, variant: parsed.data.variant });
  });

  /** The orders stored under one Idempotency-Key, to show a retry made exactly one. */
  admin.get('/admin/orders', async (c) => {
    const key = c.req.query('idempotencyKey') ?? '';
    const { results } = await db(c.env).prepare('SELECT id, buyer_id, state, net_cents FROM orders WHERE idempotency_key = ?').bind(key).all();
    return c.json({ count: results.length, orders: results });
  });

  /** A buyer's ACCEPTED ledger lines (what already took stock). */
  admin.get('/admin/ledger', async (c) => {
    const { results } = await db(c.env).prepare("SELECT order_id, product_id, delivery_date, sales_units FROM order_lines WHERE buyer_id = ? AND state = 'ACCEPTED' ORDER BY id").bind(c.req.query('buyer') ?? '').all();
    return c.json({ count: results.length, lines: results });
  });

  return admin;
}
