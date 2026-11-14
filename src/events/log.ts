import { helsinkiIso, now } from '../clock';
import type { Env } from '../env';
import { db } from '../db';

export type EventType =
  | 'draft.created'
  | 'draft.confirmed'
  | 'search.done'
  | 'valio.called'
  | 'quote.created'
  | 'policy.decided'
  | 'approval.requested'
  | 'approval.approved'
  | 'approval.rejected'
  | 'approval.expired'
  | 'order.accepted'
  | 'stock.denied'
  | 'clock.set';

export interface Event {
  seq: number;
  ts: string;
  type: EventType;
  buyerId: string;
  draftId?: string;
  quoteId?: string;
  orderId?: string;
  data: object;
}

export type NewEvent = Omit<Event, 'seq' | 'ts'>;

/**
 * Appends one event stamped with the door's clock (+02:00) and returns its seq. The insert takes an advisory lock first, so
 * seqs commit in order and a reader polling `seq > since` never skips an event that commits late.
 */
export async function logEvent(env: Env, e: NewEvent): Promise<number> {
  const ts = helsinkiIso(await now(env));
  const row = await db(env)
    .prepare(
      'WITH l AS (SELECT pg_advisory_xact_lock(2)) INSERT INTO events(order_id, buyer_id, draft_id, quote_id, kind, body, at) SELECT ?::text, ?::text, ?::text, ?::text, ?::text, ?::text, ?::text FROM l RETURNING id',
    )
    .bind(e.orderId ?? null, e.buyerId, e.draftId ?? null, e.quoteId ?? null, e.type, JSON.stringify(e.data), ts)
    .first<{ id: number }>();
  return row!.id;
}

/** Events with seq greater than `since` (optionally one buyer's), oldest first, at most `limit` (default 500). */
export async function listEvents(env: Env, q: { since: number; buyerId?: string; limit?: number }): Promise<Event[]> {
  const { results } = await db(env).prepare(
    'SELECT id, at, kind, buyer_id, draft_id, quote_id, order_id, body FROM events WHERE id > ?1 AND (?2::text IS NULL OR buyer_id = ?2) ORDER BY id LIMIT ?3',
  )
    .bind(q.since, q.buyerId ?? null, q.limit ?? 500)
    .all<Record<string, string | number | null>>();
  return results.map((r) => ({
    seq: r.id as number,
    ts: r.at as string,
    type: r.kind as EventType,
    buyerId: r.buyer_id as string,
    ...(r.draft_id ? { draftId: r.draft_id as string } : {}),
    ...(r.quote_id ? { quoteId: r.quote_id as string } : {}),
    ...(r.order_id ? { orderId: r.order_id as string } : {}),
    data: JSON.parse(r.body as string),
  }));
}
