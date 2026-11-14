import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '../src/clock';
import type { Env } from '../src/env';
import { listEvents, logEvent } from '../src/events/log';
import { db } from '../src/db';

const e = { ...(env as unknown as Env), DEMO_MODE: '1' };

describe('events', () => {
  beforeEach(async () => {
    await db(e).prepare('DELETE FROM events').run();
    await setClock(e, '2026-11-13T19:10:00Z');
  });

  it('appends with the door clock in +02:00 and reads back oldest first', async () => {
    const s1 = await logEvent(e, { type: 'draft.created', buyerId: 'b1', draftId: 'd1', data: { text: 'milk' } });
    const s2 = await logEvent(e, { type: 'valio.called', buyerId: 'b1', quoteId: 'q1', orderId: 'o1', data: { endpoint: 'price', ids: ['1'], replay: false } });
    expect(s2).toBeGreaterThan(s1);
    const out = await listEvents(e, { since: 0 });
    expect(out).toEqual([
      { seq: s1, ts: '2026-11-13T21:10:00+02:00', type: 'draft.created', buyerId: 'b1', draftId: 'd1', data: { text: 'milk' } },
      { seq: s2, ts: '2026-11-13T21:10:00+02:00', type: 'valio.called', buyerId: 'b1', quoteId: 'q1', orderId: 'o1', data: { endpoint: 'price', ids: ['1'], replay: false } },
    ]);
  });

  it('since is exclusive, buyer filters, limit caps', async () => {
    const a = await logEvent(e, { type: 'draft.confirmed', buyerId: 'b1', data: {} });
    await logEvent(e, { type: 'draft.confirmed', buyerId: 'b2', data: {} });
    await logEvent(e, { type: 'draft.confirmed', buyerId: 'b1', data: {} });
    expect((await listEvents(e, { since: a })).map((x) => x.buyerId)).toEqual(['b2', 'b1']);
    expect((await listEvents(e, { since: 0, buyerId: 'b1' })).map((x) => x.buyerId)).toEqual(['b1', 'b1']);
    expect(await listEvents(e, { since: 0, limit: 1 })).toHaveLength(1);
  });
});
