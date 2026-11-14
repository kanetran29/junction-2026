import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../src/clock';
import { db } from '../src/db';
import type { Env } from '../src/env';
import { GENESIS, listEvents, logEvent, verifyChain, type Event } from '../src/events/log';
import { createApp } from '../src/http/routes';
import { AUD, verifyJws } from '../src/sign/door';
import { canonicalJson, sha256Hex } from '../src/util';

const e = { ...(env as unknown as Env), DEMO_MODE: '1', ADMIN_KEY: 'adm' };
const app = createApp(async () => {
  throw new Error('the audit chain makes no outside call');
});
const call = (path: string, o: { key?: string; body?: unknown; env?: Env } = {}) =>
  app.request(path, { method: o.body === undefined ? 'GET' : 'POST', headers: { ...(o.key ? { Authorization: `Bearer ${o.key}` } : {}), 'Content-Type': 'application/json' }, body: o.body === undefined ? undefined : JSON.stringify(o.body) }, o.env ?? e);

/** Recomputes one link as an outside verifier would: the served event without its two hash fields, canonical JSON, prefixed by prevHash. */
const link = (ev: Event) => {
  const { prevHash, hash: _hash, ...covered } = ev;
  return sha256Hex(prevHash + canonicalJson(covered));
};

/** Asserts the served events form one unbroken chain from genesis, each hash recomputable from what is served. */
async function expectLinear(events: Event[]): Promise<void> {
  expect(events[0].prevHash).toBe(GENESIS);
  for (const [i, ev] of events.entries()) {
    if (i) {
      expect(ev.seq).toBeGreaterThan(events[i - 1].seq);
      expect(ev.prevHash).toBe(events[i - 1].hash);
    }
    expect(ev.hash).toBe(await link(ev));
  }
}

describe('hash-chained event log', () => {
  beforeEach(async () => {
    await db(e).prepare('DELETE FROM events').run();
    await setClock(e, '2026-11-13T19:10:00Z');
  });

  it('chains many events from a genesis of 64 zeros, each hash recomputable from the served event', async () => {
    expect(GENESIS).toBe('0'.repeat(64));
    for (let i = 0; i < 30; i++) {
      await logEvent(e, { type: i % 2 ? 'valio.called' : 'quote.created', buyerId: `b${i % 3}`, quoteId: `q${i}`, ...(i % 5 ? {} : { orderId: `o${i}` }), ...(i % 7 ? {} : { draftId: `d${i}` }), data: { i, ids: ['1', 'é'], nested: { z: 1, a: [i, 0.5] } } });
    }
    const events = await listEvents(e, { since: 0 });
    expect(events).toHaveLength(30);
    await expectLinear(events);
    expect(await verifyChain(e)).toEqual({ count: 30, firstSeq: events[0].seq, headSeq: events[29].seq, headHash: events[29].hash, valid: true });
  });

  it('stays one linear chain when many events are written at once', async () => {
    await Promise.all(Array.from({ length: 25 }, (_, i) => logEvent(e, { type: 'stock.denied', buyerId: `b${i % 4}`, data: { productId: String(i), remaining: i } })));
    const events = await listEvents(e, { since: 0 });
    expect(events).toHaveLength(25);
    await expectLinear(events);
    expect(new Set(events.map((x) => x.prevHash)).size).toBe(25);
    expect((await verifyChain(e)).valid).toBe(true);
  });

  it('never changes a hash a reader has seen: later events only extend the chain', async () => {
    await logEvent(e, { type: 'draft.confirmed', buyerId: 'b1', data: {} });
    const seen = await listEvents(e, { since: 0 });
    await Promise.all([1, 2, 3].map(() => logEvent(e, { type: 'draft.confirmed', buyerId: 'b2', data: {} })));
    const later = await listEvents(e, { since: 0 });
    expect(later[0]).toEqual(seen[0]);
    const tail = await listEvents(e, { since: seen[0].seq });
    expect(tail.map((x) => x.seq)).toEqual(later.slice(1).map((x) => x.seq));
  });

  it('names the first bad seq when data, a link or a row is changed behind the door', async () => {
    const seqs: number[] = [];
    for (let i = 0; i < 5; i++) seqs.push(await logEvent(e, { type: 'order.accepted', buyerId: 'b1', orderId: `o${i}`, data: { netCents: 100 * i } }));
    await db(e).prepare("UPDATE events SET body = '{\"netCents\":1}' WHERE id = ?").bind(seqs[3]).run();
    expect(await verifyChain(e)).toMatchObject({ count: 5, valid: false, firstBadSeq: seqs[3] });
    await db(e).prepare("UPDATE events SET prev_hash = ? WHERE id = ?").bind('f'.repeat(64), seqs[1]).run();
    expect(await verifyChain(e)).toMatchObject({ valid: false, firstBadSeq: seqs[1] });
  });

  it('notices a deleted event at the next one', async () => {
    const seqs: number[] = [];
    for (let i = 0; i < 4; i++) seqs.push(await logEvent(e, { type: 'draft.confirmed', buyerId: 'b1', data: { i } }));
    await db(e).prepare('DELETE FROM events WHERE id = ?').bind(seqs[1]).run();
    expect(await verifyChain(e)).toMatchObject({ count: 3, valid: false, firstBadSeq: seqs[2] });
  });

  it('is valid and empty with no events (head is the genesis)', async () => {
    expect(await verifyChain(e)).toEqual({ count: 0, firstSeq: null, headSeq: null, headHash: GENESIS, valid: true });
  });
});

describe('/v1/events, /v1/audit/verify, /admin/tamper and /admin/reset', () => {
  beforeEach(async () => {
    await db(e).prepare('DELETE FROM events').run();
    await setClock(e, '2026-11-13T19:10:00Z');
  });

  it('serves prevHash and hash with every event', async () => {
    await logEvent(e, { type: 'draft.confirmed', buyerId: 'hotel-a', data: {} });
    const [ev] = ((await (await call('/v1/events')).json()) as { events: Event[] }).events;
    expect(ev).toEqual({ seq: expect.any(Number), ts: '2026-11-13T21:10:00+02:00', type: 'draft.confirmed', buyerId: 'hotel-a', data: {}, prevHash: GENESIS, hash: await link(ev) });
  });

  it('verify is public (no key, even off demo) and signs its answer with the door key', async () => {
    for (let i = 0; i < 3; i++) await logEvent(e, { type: 'draft.confirmed', buyerId: 'hotel-a', data: { i } });
    for (const env of [e, { ...e, DEMO_MODE: '0' }]) {
      const r = await call('/v1/audit/verify', { env });
      expect(r.status).toBe(200);
      const body = (await r.json()) as Record<string, unknown> & { jws: string };
      const { jws, ...result } = body;
      expect(result).toEqual({ count: 3, firstSeq: expect.any(Number), headSeq: expect.any(Number), headHash: expect.stringMatching(/^[0-9a-f]{64}$/), valid: true, checkedAt: env.DEMO_MODE === '1' ? '2026-11-13T21:10:00+02:00' : expect.stringMatching(/\+0[23]:00$/) });
      expect(await verifyJws(e, jws, AUD.audit)).toEqual({ ...result, aud: AUD.audit });
    }
  });

  it('limits verify to 30 a minute per client address', async () => {
    await db(e).prepare('DELETE FROM rate_limits').run();
    const from = (ip: string) => app.request('/v1/audit/verify', { headers: { 'CF-Connecting-IP': ip } }, e);
    for (let i = 0; i < 30; i++) expect((await from('203.0.113.7')).status).toBe(200);
    const limited = await from('203.0.113.7');
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: 'RATE_LIMITED' });
    expect((await from('203.0.113.8')).status).toBe(200);
    await db(e).prepare('DELETE FROM rate_limits').run();
  });

  it('tamper (admin, demo only) breaks verify at the named seq, and reset restores a fresh chain', async () => {
    const seqs: number[] = [];
    for (let i = 0; i < 3; i++) seqs.push(await logEvent(e, { type: 'order.accepted', buyerId: 'hotel-a', orderId: `o${i}`, data: { netCents: i } }));
    expect((await call('/admin/tamper', { body: { seq: seqs[1] } })).status).toBe(401);
    expect((await call('/admin/tamper', { key: 'adm', body: { seq: seqs[1] }, env: { ...e, DEMO_MODE: '0' } })).status).toBe(404);
    expect((await call('/admin/tamper', { key: 'adm', body: { seq: 999999 } })).status).toBe(404);
    const t = await call('/admin/tamper', { key: 'adm', body: { seq: seqs[1] } });
    expect(await t.json()).toEqual({ tampered: seqs[1] });
    expect(await (await call('/v1/audit/verify')).json()).toMatchObject({ valid: false, firstBadSeq: seqs[1] });
    expect((await listEvents(e, { since: 0 }))[1].data).toMatchObject({ tampered: true });

    expect(await (await call('/admin/tamper', { key: 'adm', body: {} })).json()).toEqual({ tampered: seqs[2] });

    expect((await call('/admin/reset', { key: 'adm', body: { clock: '2026-11-13T21:10:00+02:00' } })).status).toBe(200);
    const after = await listEvents(e, { since: 0 });
    expect(after.map((x) => x.type)).toEqual(['clock.set']);
    expect(after[0].prevHash).toBe(GENESIS);
    expect(after[0].seq).toBeGreaterThan(seqs[2]);
    expect(await (await call('/v1/audit/verify')).json()).toMatchObject({ count: 1, valid: true });
  });
});
