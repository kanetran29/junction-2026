import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { MANDATE_AUD, defaultMandate } from '../src/domain/constants';
import { generateBuyerKeys, loadMandate, saveMandate, seedMandate, signMandate, verifyMandate } from '../src/mandate/jws';

const NOW = new Date('2026-11-13T21:10:00+02:00');
const ctx = { now: NOW, aud: MANDATE_AUD };
const m = defaultMandate('hotel-a');

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? 'NO_CODE';
  }
  return 'OK';
}

function b64u(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('mandate jws', () => {
  it('round trips', async () => {
    const k = await generateBuyerKeys();
    const jws = await signMandate(m, k.privateJwk);
    expect(await verifyMandate(jws, k.publicJwk, ctx)).toEqual(m);
  });

  it('a changed payload byte is MANDATE_INVALID', async () => {
    const k = await generateBuyerKeys();
    const [h, p, s] = (await signMandate(m, k.privateJwk)).split('.');
    const i = 10;
    const flipped = p.slice(0, i) + (p[i] === 'A' ? 'B' : 'A') + p.slice(i + 1);
    expect(await code(verifyMandate(`${h}.${flipped}.${s}`, k.publicJwk, ctx))).toBe('MANDATE_INVALID');
  });

  it('another buyer key is MANDATE_INVALID', async () => {
    const k = await generateBuyerKeys();
    const other = await generateBuyerKeys();
    const jws = await signMandate(m, k.privateJwk);
    expect(await code(verifyMandate(jws, other.publicJwk, ctx))).toBe('MANDATE_INVALID');
  });

  it('older version than the minimum is MANDATE_INVALID', async () => {
    const k = await generateBuyerKeys();
    const v1 = await signMandate({ ...m, version: 1 }, k.privateJwk);
    expect(await code(verifyMandate(v1, k.publicJwk, { ...ctx, minVersion: 2 }))).toBe('MANDATE_INVALID');
    expect(await code(verifyMandate(v1, k.publicJwk, { ...ctx, minVersion: 1 }))).toBe('OK');
  });

  it('past exp is MANDATE_EXPIRED, exactly exp too', async () => {
    const k = await generateBuyerKeys();
    const jws = await signMandate({ ...m, exp: '2026-11-13T21:10:00+02:00' }, k.privateJwk);
    expect(await code(verifyMandate(jws, k.publicJwk, ctx))).toBe('MANDATE_EXPIRED');
    expect(await code(verifyMandate(jws, k.publicJwk, { ...ctx, now: new Date(NOW.getTime() - 1000) }))).toBe('OK');
  });

  it('other aud is MANDATE_INVALID', async () => {
    const k = await generateBuyerKeys();
    const jws = await signMandate({ ...m, aud: 'someone-else' }, k.privateJwk);
    expect(await code(verifyMandate(jws, k.publicJwk, ctx))).toBe('MANDATE_INVALID');
  });

  it('wrong buyerId is MANDATE_INVALID', async () => {
    const k = await generateBuyerKeys();
    const jws = await signMandate(m, k.privateJwk);
    expect(await code(verifyMandate(jws, k.publicJwk, { ...ctx, buyerId: 'hotel-b' }))).toBe('MANDATE_INVALID');
  });

  it('rejects alg none and any non-EdDSA alg, even with a valid signature', async () => {
    const k = await generateBuyerKeys();
    const [, p, s] = (await signMandate(m, k.privateJwk)).split('.');
    for (const alg of ['none', 'HS256', 'ES256']) {
      const h = b64u(JSON.stringify({ alg, kid: 'hotel-a' }));
      expect(await code(verifyMandate(`${h}.${p}.${s}`, k.publicJwk, ctx))).toBe('MANDATE_INVALID');
    }
    const h = b64u(JSON.stringify({ alg: 'none' }));
    expect(await code(verifyMandate(`${h}.${p}.`, k.publicJwk, ctx))).toBe('MANDATE_INVALID');
  });

  it('rejects malformed tokens', async () => {
    const k = await generateBuyerKeys();
    for (const t of ['', 'a.b', 'a.b.c.d', '!!.!!.!!']) {
      expect(await code(verifyMandate(t, k.publicJwk, ctx))).toBe('MANDATE_INVALID');
    }
  });
});

describe('mandate store', () => {
  beforeEach(async () => {
    await env.DB.batch([env.DB.prepare('DELETE FROM mandates'), env.DB.prepare('DELETE FROM buyer_keys')]);
  });

  it('save then load round trips', async () => {
    const k = await generateBuyerKeys();
    await saveMandate(env, 'hotel-a', await signMandate(m, k.privateJwk), k.publicJwk);
    expect(await loadMandate(env, 'hotel-a', ctx)).toEqual(m);
  });

  it('load with no mandate is MANDATE_INVALID', async () => {
    expect(await code(loadMandate(env, 'hotel-a', ctx))).toBe('MANDATE_INVALID');
  });

  it('saving an older version over a newer one is refused', async () => {
    const k = await generateBuyerKeys();
    await saveMandate(env, 'hotel-a', await signMandate({ ...m, version: 2 }, k.privateJwk), k.publicJwk);
    const v1 = await signMandate({ ...m, version: 1 }, k.privateJwk);
    expect(await code(saveMandate(env, 'hotel-a', v1, k.publicJwk))).toBe('MANDATE_INVALID');
    expect((await loadMandate(env, 'hotel-a', ctx)).version).toBe(2);
  });

  it('seedMandate with tamper stores a mandate that fails verification', async () => {
    await seedMandate(env, 'hotel-a', {}, { tamper: true });
    expect(await code(loadMandate(env, 'hotel-a', ctx))).toBe('MANDATE_INVALID');
  });

  it('seedMandate applies overrides and loads clean', async () => {
    await seedMandate(env, 'hotel-b', { reliabilityFloor: 0.5 });
    const loaded = await loadMandate(env, 'hotel-b', ctx);
    expect(loaded.reliabilityFloor).toBe(0.5);
    expect(loaded.buyerId).toBe('hotel-b');
  });
});
