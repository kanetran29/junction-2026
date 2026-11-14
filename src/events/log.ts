import { helsinkiIso, now } from '../clock';
import type { Env } from '../env';
import { db, transaction, type Db } from '../db';
import { canonicalJson, sha256Hex } from '../util';

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

/** What one link of the chain covers: every served field of an event except its two hashes (absent ids are left out). */
export interface ChainedFields {
  seq: number;
  ts: string;
  type: EventType;
  buyerId: string;
  draftId?: string;
  quoteId?: string;
  orderId?: string;
  data: object;
}

/** One event as served: its fields, the hash of the event before it (`prevHash`, genesis for the first) and its own `hash`. */
export interface Event extends ChainedFields {
  prevHash: string;
  hash: string;
}

export type NewEvent = Omit<ChainedFields, 'seq' | 'ts'>;

/** The `prevHash` of the first event, and the head of an empty log: 64 zeros. */
export const GENESIS = '0'.repeat(64);

/** The advisory lock every event insert holds until it commits, so the chain and the seqs grow one event at a time. */
export const EVENT_LOCK = 2;

/** One link: hex sha256 of the UTF-8 bytes of `prevHash` (64 hex characters) followed by the event's canonical JSON. */
export function chainHash(prevHash: string, e: ChainedFields): Promise<string> {
  return sha256Hex(prevHash + canonicalJson(e));
}

/** The covered fields of an event, with absent ids left out and `data` as it reads back from JSON. */
function covered(e: NewEvent & { seq: number; ts: string }): ChainedFields {
  return {
    seq: e.seq,
    ts: e.ts,
    type: e.type,
    buyerId: e.buyerId,
    ...(e.draftId ? { draftId: e.draftId } : {}),
    ...(e.quoteId ? { quoteId: e.quoteId } : {}),
    ...(e.orderId ? { orderId: e.orderId } : {}),
    data: JSON.parse(JSON.stringify(e.data)),
  };
}

/**
 * Appends one event stamped with the door's clock (+02:00) and returns its seq. In one transaction it takes the event
 * lock, then (in a later statement, so it sees every event committed before the lock was granted) draws the next seq and
 * reads the previous hash, hashes the new event onto it and inserts it. Seqs therefore commit in order, a reader polling
 * `seq > since` never skips an event that commits late, and no stored hash ever changes.
 */
export async function logEvent(env: Env, e: NewEvent): Promise<number> {
  const ts = helsinkiIso(await now(env));
  return transaction(env, async (s) => {
    await s.prepare(`SELECT pg_advisory_xact_lock(${EVENT_LOCK})`).run();
    const next = (await s
      .prepare("SELECT nextval(pg_get_serial_sequence('events', 'id')) AS seq, (SELECT hash FROM events ORDER BY id DESC LIMIT 1) AS prev")
      .first<{ seq: number; prev: string | null }>())!;
    const event = covered({ ...e, seq: next.seq, ts });
    const prevHash = next.prev ?? GENESIS;
    await s
      .prepare(
        'INSERT INTO events(id, order_id, buyer_id, draft_id, quote_id, kind, body, at, prev_hash, hash) OVERRIDING SYSTEM VALUE VALUES (?::bigint, ?::text, ?::text, ?::text, ?::text, ?::text, ?::text, ?::text, ?::text, ?::text)',
      )
      .bind(event.seq, event.orderId ?? null, event.buyerId, event.draftId ?? null, event.quoteId ?? null, event.type, JSON.stringify(event.data), ts, prevHash, await chainHash(prevHash, event))
      .run();
    return event.seq;
  });
}

/** Events with seq greater than `since` (optionally one buyer's), oldest first, at most `limit` (default 500), with their hashes. */
export function listEvents(env: Env, q: { since: number; buyerId?: string; limit?: number }): Promise<Event[]> {
  return eventsPage(db(env), q);
}

/** One page of events read through `store` (the client, or an open transaction so every page sees one snapshot). */
async function eventsPage(store: Pick<Db, 'prepare'>, q: { since: number; buyerId?: string; limit?: number }): Promise<Event[]> {
  const { results } = await store.prepare(
    'SELECT id, at, kind, buyer_id, draft_id, quote_id, order_id, body, prev_hash, hash FROM events WHERE id > ?1::bigint AND (?2::text IS NULL OR buyer_id = ?2) ORDER BY id LIMIT ?3',
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
    prevHash: r.prev_hash as string,
    hash: r.hash as string,
  }));
}

/** What `/v1/audit/verify` recomputes: how many events, the first and last seq, the head hash, and the first seq that fails. */
export interface ChainCheck {
  count: number;
  firstSeq: number | null;
  headSeq: number | null;
  headHash: string;
  valid: boolean;
  firstBadSeq?: number;
}

/**
 * Recomputes the whole chain, oldest first, a page at a time inside one REPEATABLE READ transaction (so a reset or new
 * events landing meanwhile cannot make a healthy log look broken): each event's `prevHash` must be the stored hash of the
 * event before it (genesis for the first) and its `hash` must be `chainHash(prevHash, fields)`. The first event that fails
 * either check is `firstBadSeq`; checking goes on from its stored hash, so one changed event is reported once. A removed
 * event shows at the event after it; events removed from the end need an earlier signed head to notice.
 */
export function verifyChain(env: Env): Promise<ChainCheck> {
  return transaction(env, async (s) => {
    await s.prepare('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY').run();
    let prev = GENESIS;
    let count = 0;
    let firstSeq: number | null = null;
    let headSeq: number | null = null;
    let firstBadSeq: number | undefined;
    for (;;) {
      const page = await eventsPage(s, { since: headSeq ?? 0, limit: 1000 });
      if (!page.length) break;
      for (const { prevHash, hash, ...fields } of page) {
        if (firstBadSeq === undefined && (prevHash !== prev || (await chainHash(prevHash, fields)) !== hash)) firstBadSeq = fields.seq;
        firstSeq ??= fields.seq;
        headSeq = fields.seq;
        prev = hash;
        count++;
      }
    }
    return { count, firstSeq, headSeq, headHash: prev, valid: firstBadSeq === undefined, ...(firstBadSeq === undefined ? {} : { firstBadSeq }) };
  });
}
