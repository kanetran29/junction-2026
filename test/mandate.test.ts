import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { MANDATE_AUD, defaultMandate } from '../src/domain/constants';
import { generateBuyerKeys, loadMandate, saveMandate, seedMandate, signMandate, verifyMandate } from '../src/mandate/jws';
import { db } from '../src/db';

const NOW = new Date('2026-11-13T21:10:00+02:00');
const ctx = { now: NOW, aud: MANDATE_AUD };
const m = defaultMandate('hotel-a');

/** Awaits a promise and returns the `code` of the error it throws, or 'OK' when it resolves. */
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? 'NO_CODE';
  }
  return 'OK';
}

/** Unpadded base64url of a string, for hand-building token parts. */
function b64u(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Signs an arbitrary payload with a valid EdDSA header, to test that shape validation runs after the signature check. */
async function signRaw(privateJwk: JsonWebKey, payload: unknown): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'Ed25519' }, false, ['sign']);
  const input = `${b64u(JSON.stringify({ alg: 'EdDSA', kid: 'hotel-a' }))}.${b64u(JSON.stringify(payload))}`;
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(input)));
  return `${input}.${btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
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

  it('rejects alg none and any non-EdDSA alg even when signed with the real key', async () => {
    const k = await generateBuyerKeys();
    const key = await crypto.subtle.importKey('jwk', k.privateJwk, { name: 'Ed25519' }, false, ['sign']);
    const [, p] = (await signMandate(m, k.privateJwk)).split('.');
    for (const alg of ['none', 'HS256', 'ES256']) {
      const h = b64u(JSON.stringify({ alg, kid: 'hotel-a' }));
      const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(`${h}.${p}`)));
      const s = btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const token = `${h}.${p}.${s}`;
      expect(await code(verifyMandate(token, k.publicJwk, ctx))).toBe('MANDATE_INVALID');
      // same token with the header swapped to EdDSA must fail the signature, proving the alg check is what rejected it
      expect(await verifyMandate(`${b64u(JSON.stringify({ alg: 'EdDSA', kid: 'hotel-a' }))}.${p}.${s}`, k.publicJwk, ctx).catch((e) => e.code)).toBe('MANDATE_INVALID');
    }
  });

  it('rejects non-canonical base64url and bad payload shapes even when signed', async () => {
    const k = await generateBuyerKeys();
    const [h, p, s] = (await signMandate(m, k.privateJwk)).split('.');
    expect(await code(verifyMandate(`${h}.${p}.${s}A`, k.publicJwk, ctx))).toBe('MANDATE_INVALID');
    const bad: unknown[] = [
      null,
      { ...m, perOrder: { autoCents: 10, hardCents: 5 } },
      { ...m, perDay: { autoCents: -1, hardCents: 5 } },
      { ...m, perOrder: { autoCents: 1.5, hardCents: 5 } },
      { ...m, reliabilityFloor: 2 },
      { ...m, reliabilityUnknown: 'maybe' },
      { ...m, approver: { name: '' } },
      { ...m, exp: 'not a date' },
      { ...m, version: 0 },
    ];
    for (const payload of bad) {
      const jws = await signRaw(k.privateJwk, payload);
      expect(await code(verifyMandate(jws, k.publicJwk, ctx))).toBe('MANDATE_INVALID');
    }
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
    await db(env).batch([db(env).prepare('DELETE FROM mandates'), db(env).prepare('DELETE FROM buyer_keys')]);
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

  it('saving a wrong-aud mandate is refused', async () => {
    const k = await generateBuyerKeys();
    const jws = await signMandate({ ...m, aud: 'someone-else' }, k.privateJwk);
    expect(await code(saveMandate(env, 'hotel-a', jws, k.publicJwk))).toBe('MANDATE_INVALID');
    expect(await code(loadMandate(env, 'hotel-a', ctx))).toBe('MANDATE_INVALID');
  });

  it('an unparseable stored row makes the save fail, not pass', async () => {
    const k = await generateBuyerKeys();
    await db(env).batch([
      db(env).prepare("INSERT INTO buyer_keys(buyer_id, public_key) VALUES('hotel-a', '{}')"),
      db(env).prepare("INSERT INTO mandates(buyer_id, payload, signature) VALUES('hotel-a', 'x.y', 'z')"),
    ]);
    expect(await code(saveMandate(env, 'hotel-a', await signMandate(m, k.privateJwk), k.publicJwk))).toBe('MANDATE_INVALID');
  });

  it('an unparseable stored public key loads as MANDATE_INVALID', async () => {
    await seedMandate(env, 'hotel-a');
    await db(env).prepare("UPDATE buyer_keys SET public_key = 'not json' WHERE buyer_id = 'hotel-a'").run();
    expect(await code(loadMandate(env, 'hotel-a', ctx))).toBe('MANDATE_INVALID');
  });

  it('seedMandate keeps hardCents when only autoCents is overridden', async () => {
    await seedMandate(env, 'hotel-a', { perOrder: { autoCents: 1000 } });
    const loaded = await loadMandate(env, 'hotel-a', ctx);
    expect(loaded.perOrder).toEqual({ autoCents: 1000, hardCents: 500000 });
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
