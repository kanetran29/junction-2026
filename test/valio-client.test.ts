import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { fetchOffers, ValioError, ValioRateLimited, clearValioBlock } from '../src/valio/client';
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
  it('a 200 with a non-JSON body or without a products array is a ValioError', async () => {
    const html = vi.fn(async () => new Response('<html>oops</html>', { status: 200 })) as unknown as typeof fetch;
    await expect(fetchOffers(e, ['T0001'], '2026-11-16', html)).rejects.toBeInstanceOf(ValioError);
    const bare = vi.fn(async () => new Response(JSON.stringify({ timeNow: 'x' }), { status: 200 })) as unknown as typeof fetch;
    await expect(fetchOffers(e, ['T0001'], '2026-11-16', bare)).rejects.toBeInstanceOf(ValioError);
  });
});

describe('fetchOffers honours Valio 429', () => {
  const limited = (retryAfter?: string) => vi.fn(async () => new Response('slow down', { status: 429, headers: retryAfter ? { 'Retry-After': retryAfter } : {} })) as unknown as typeof fetch;
  beforeEach(async () => {
    await e.DB.prepare("DELETE FROM settings WHERE key IN ('replay', 'clock')").run();
    clearValioBlock();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    clearValioBlock();
  });

  it('a 429 is a ValioRateLimited with 30 s, and the next call within 30 s makes no fetch', async () => {
    const first = limited();
    const err = await fetchOffers(e, ['T0001'], '2026-11-16', first).catch((x) => x);
    expect(err).toBeInstanceOf(ValioRateLimited);
    expect(err.retryAfter).toBe(30);
    const calls = (first as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    vi.setSystemTime(new Date('2026-11-14T10:00:10Z'));
    const second = fakeValio();
    const again = await fetchOffers(e, ['T0001'], '2026-11-16', second.fn).catch((x) => x);
    expect(again).toBeInstanceOf(ValioRateLimited);
    expect(again.retryAfter).toBe(20);
    expect(second.calls).toEqual([]);
    expect(calls).toBeGreaterThan(0);
  });

  it('after 30 s it fetches again', async () => {
    await fetchOffers(e, ['T0001'], '2026-11-16', limited()).catch(() => undefined);
    vi.setSystemTime(new Date('2026-11-14T10:00:30Z'));
    const v = fakeValio();
    await fetchOffers(e, ['T0001'], '2026-11-16', v.fn);
    expect(v.calls).toHaveLength(2);
  });

  it('a Retry-After of 5 seconds blocks 5 s, and an HTTP date is read too', async () => {
    const err = await fetchOffers(e, ['T0001'], '2026-11-16', limited('5')).catch((x) => x);
    expect(err.retryAfter).toBe(5);
    vi.setSystemTime(new Date('2026-11-14T10:00:05Z'));
    const v = fakeValio();
    await fetchOffers(e, ['T0001'], '2026-11-16', v.fn);
    expect(v.calls).toHaveLength(2);
    clearValioBlock();
    const date = new Date('2026-11-14T10:00:50Z').toUTCString();
    const byDate = await fetchOffers(e, ['T0001'], '2026-11-16', limited(date)).catch((x) => x);
    expect(byDate.retryAfter).toBe(45);
  });

  it('is not tied to the demo clock: with the demo clock frozen, 30 s of real time ends the block', async () => {
    await setClock(e, '2020-01-01T00:00:00Z');
    await fetchOffers(e, ['T0001'], '2026-11-16', limited()).catch(() => undefined);
    vi.setSystemTime(new Date('2026-11-14T10:00:30Z'));
    const v = fakeValio();
    await fetchOffers(e, ['T0001'], '2026-11-16', v.fn);
    expect(v.calls).toHaveLength(2);
  });

  it.each([
    ['86400', 300],
    ['1e308', 300],
    ['1e21', 300],
    ['0', 1],
    ['Fri, 01 Jan 2100 00:00:00 GMT', 300],
  ])('clamps Retry-After %s to %s whole seconds', async (header, secs) => {
    const err = await fetchOffers(e, ['T0001'], '2026-11-16', limited(header)).catch((x) => x);
    expect(err.retryAfter).toBe(secs);
    expect(Number.isInteger(err.retryAfter)).toBe(true);
  });

  it('replay mode ignores an active block', async () => {
    await fetchOffers(e, ['T0001'], '2026-11-16', limited()).catch(() => undefined);
    await e.DB.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('replay', '1')").run();
    const r = await fetchOffers(e, ['T0001'], '2026-11-16', fakeValio().fn);
    await e.DB.prepare("DELETE FROM settings WHERE key = 'replay'").run();
    expect(r.replay).toBe(true);
  });

  it('a block another request learns during one batch stops the next batch', async () => {
    const ids = Array.from({ length: 2500 }, (_, i) => `X${i}`);
    const v = fakeValio();
    let other: Promise<unknown> | undefined;
    const fn = vi.fn(async (url: string, init: RequestInit) => {
      other ??= fetchOffers(e, ['T0001'], '2026-11-16', limited()).catch(() => undefined);
      await other;
      return (v.fn as unknown as (u: string, i: RequestInit) => Promise<Response>)(url, init);
    }) as unknown as typeof fetch;
    await expect(fetchOffers(e, ids, '2026-11-16', fn)).rejects.toBeInstanceOf(ValioRateLimited);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
