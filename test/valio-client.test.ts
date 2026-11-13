import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { fetchOffers, ValioError } from '../src/valio/client';
import { setClock } from '../src/clock';
import fixture from './fixtures/valio-replies.json';

const e = { ...(env as unknown as Env), DEMO_MODE: '1', VALIO_API_KEY: 'test-key-123' };
const reply = (kind: 'availability' | 'price', ids: string[]) => ({
  ...fixture[kind][0],
  products: (fixture[kind][0].products as { productId: string }[]).filter((p) => ids.includes(p.productId)),
});

/** A fake Valio: answers each call from the fixture by endpoint and records what it was asked. */
function fakeValio() {
  const calls: { url: string; headers: Record<string, string>; body: { products: string[]; customer: string; requestedDate: string } }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    calls.push({ url, headers: init.headers as Record<string, string>, body });
    return new Response(JSON.stringify(reply(url.endsWith('availability') ? 'availability' : 'price', body.products)), { status: 200 });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe('fetchOffers live', () => {
  beforeEach(async () => {
    await e.DB.prepare("DELETE FROM settings WHERE key IN ('replay', 'clock')").run();
    await setClock(e, '2026-11-13T19:10:00Z');
  });

  it('sends the API key, the custom user agent and the body, and normalises +0200', async () => {
    const v = fakeValio();
    const r = await fetchOffers(e, ['T0001', 'T0004'], '2026-11-16', v.fn);
    expect(v.calls).toHaveLength(2);
    expect(v.calls[0].url).toBe('https://junction26.valioaimo.fi/api/availability');
    expect(v.calls[0].headers).toMatchObject({ 'X-API-Key': 'test-key-123', 'User-Agent': 'lazydoor/0.1', 'Content-Type': 'application/json' });
    expect(v.calls[0].body).toEqual({ customer: 'lazydoor', requestedDate: '2026-11-16', products: ['T0001', 'T0004'] });
    expect(r).toMatchObject({ calls: 2, liveCalls: 2, replay: false, ids: ['T0001', 'T0004'] });
    expect(r.availability.get('T0001')?.closingTime).toBe('2026-11-15T17:00:00+02:00');
    expect(r.price.get('T0004')?.catalogPrice?.validFrom).toBe('2026-01-13T00:00:00+02:00');
    expect(r.timeNow).toBe('2026-11-13T21:10:00+02:00');
  });

  it('splits 1,200 ids into two calls per endpoint', async () => {
    const v = fakeValio();
    const ids = Array.from({ length: 1200 }, (_, i) => `X${i}`);
    const r = await fetchOffers(e, ids, '2026-11-16', v.fn);
    expect(v.calls.map((c) => c.body.products.length).sort((a, b) => a - b)).toEqual([200, 200, 1000, 1000]);
    expect(r.calls).toBe(4);
  });

  it('surfaces a non-200 and a network error as ValioError', async () => {
    const bad = vi.fn(async () => new Response('no', { status: 503 })) as unknown as typeof fetch;
    await expect(fetchOffers(e, ['T0001'], '2026-11-16', bad)).rejects.toBeInstanceOf(ValioError);
    const down = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    await expect(fetchOffers(e, ['T0001'], '2026-11-16', down)).rejects.toBeInstanceOf(ValioError);
  });
});
