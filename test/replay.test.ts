import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setClock } from '../src/clock';
import type { Env } from '../src/env';
import { fetchOffers } from '../src/valio/client';
import fixture from './fixtures/valio-replies.json';
import { db } from '../src/db';

const e = { ...(env as unknown as Env), DEMO_MODE: '1', VALIO_API_KEY: 'test-key-123' };

describe('fetchOffers in replay', () => {
  const REC = 'replies_test';
  beforeEach(async () => {
    await db(e).prepare("DELETE FROM settings WHERE key IN ('replay', 'clock', 'recording', 'variants')").run();
    await e.DB.prepare('DELETE FROM valio_replies').run();
    const rows = (['availability', 'price'] as const).flatMap((kind) =>
      (fixture[kind][0].products as { productId: string }[]).map((p) =>
        e.DB.prepare('INSERT INTO valio_replies(recording, kind, product_id, body, time_now) VALUES (?,?,?,?,?)').bind(REC, kind, p.productId, JSON.stringify(p), fixture[kind][0].timeNow),
      ),
    );
    await e.DB.batch(rows);
    await db(e).batch([
      db(e).prepare("INSERT INTO settings(key, value) VALUES ('replay', '1')"),
      db(e).prepare("INSERT INTO settings(key, value) VALUES ('recording', ?)").bind(REC),
    ]);
  });
  afterEach(async () => {
    await db(e).prepare("DELETE FROM settings WHERE key IN ('replay', 'recording', 'variants')").run();
  });

  const never = vi.fn(async () => {
    throw new Error('network must not be used in replay');
  }) as unknown as typeof fetch;

  it('replay returns the recorded reply verbatim with zero fetches', async () => {
    const r = await fetchOffers(e, ['T0004', 'T0001'], '2026-11-16', never);
    expect(never).not.toHaveBeenCalled();
    expect(r).toMatchObject({ replay: true, liveCalls: 0, calls: 2, ids: ['T0004', 'T0001'] });
    expect(r.availability.get('T0004')?.scheduleLines).toEqual([{ salesBlock: false, availableAmount: 384, availableDate: '2026-11-16', salesUnit: 'ST' }]);
    expect(r.price.get('T0004')?.catalogPrice?.value).toBe(4.5);
  });

  it('an id missing from the recording behaves like the mock unknown product', async () => {
    const r = await fetchOffers(e, ['NOPE'], '2026-11-16', never);
    expect(r.availability.get('NOPE')?.scheduleLines).toEqual([]);
    expect(r.price.get('NOPE')).toMatchObject({ error: true, catalogPrice: null });
  });

  it('replays by the clock alone once now() reaches Sun 15 Nov 15:00 UTC, with the default recording', async () => {
    await db(e).prepare("DELETE FROM settings WHERE key IN ('replay', 'recording')").run();
    await e.DB.prepare('UPDATE valio_replies SET recording = ?').bind('replies_2026-11-16').run();
    await setClock(e, '2026-11-15T15:00:00Z');
    const r = await fetchOffers(e, ['T0004'], '2026-11-16', never);
    expect(r.replay).toBe(true);
    expect(r.price.get('T0004')?.catalogPrice?.value).toBe(4.5);
    await setClock(e, null);
  });

  it('variant out_of_stock empties that product schedule lines only', async () => {
    await db(e).prepare("INSERT INTO settings(key, value) VALUES ('variants', ?)").bind(JSON.stringify({ T0004: 'out_of_stock' })).run();
    const r = await fetchOffers(e, ['T0004', 'T0001'], '2026-11-16', never);
    expect(r.availability.get('T0004')?.scheduleLines).toEqual([]);
    expect(r.availability.get('T0001')?.scheduleLines).toHaveLength(1);
  });

  it('variant price_plus_10pct multiplies catalog and comparison prices, cents half up', async () => {
    await db(e).prepare("INSERT INTO settings(key, value) VALUES ('variants', ?)").bind(JSON.stringify({ T0004: 'price_plus_10pct' })).run();
    const r = await fetchOffers(e, ['T0004', 'T0001'], '2026-11-16', never);
    expect(r.price.get('T0004')?.catalogPrice?.value).toBe(4.95);
    expect(r.price.get('T0004')?.comparisonPrice?.value).toBe(0.99);
    expect(r.price.get('T0004')?.catalogPrice?.valueWithTax).toBe(5.62);
    expect(r.price.get('T0001')?.catalogPrice?.value).toBe(13.32);
  });
});
