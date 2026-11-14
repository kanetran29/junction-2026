import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { AUD, doorKey, jwks, signJws, verifyJws } from '../src/sign/door';
import { b64u, canonicalJson, fromB64u } from '../src/util';
import { decodeJws, verifyWithJwks } from './jws-helpers';

const e = env as unknown as Env;
const enc = new TextEncoder();
const parts = (jws: string) => {
  const { header, claims } = decodeJws(jws);
  return { header, payload: claims };
};

describe('canonical JSON (RFC 8785 style)', () => {
  it('sorts keys at every depth, keeps array order and drops whitespace and undefined members', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' }, u: undefined })).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it('serialises strings and numbers as ECMAScript JSON does, and sorts keys by UTF-16 code units', () => {
    expect(canonicalJson({ 'é': 'ä\n"', a: 1e21, b: 0.1 + 0.2, c: -0, B: true, n: null })).toBe('{"B":true,"a":1e+21,"b":0.30000000000000004,"c":0,"n":null,"é":"ä\\n\\""}');
  });

  it('is the same before and after a JSON round trip', () => {
    const v = { at: new Date('2026-11-13T19:10:00Z'), list: [1, undefined, 'x'], nested: { k: 2 } };
    expect(canonicalJson(v)).toBe(canonicalJson(JSON.parse(JSON.stringify(v))));
  });
});

describe('base64url', () => {
  it('round-trips bytes without padding and refuses non-canonical or bad input', () => {
    const bytes = new Uint8Array([0, 251, 255, 1]);
    expect(b64u(bytes)).toBe('APv_AQ');
    expect([...fromB64u('APv_AQ')!]).toEqual([...bytes]);
    expect(fromB64u('APv_AQ==')).toBeNull();
    expect(fromB64u('AP+/AQ')).toBeNull();
    expect(fromB64u('APv_AR')).toBeNull();
  });
});

describe('the door signing key', () => {
  it('publishes one Ed25519 public key with its RFC 7638 thumbprint as kid and never the private part', async () => {
    const set = await jwks(e);
    expect(set.keys).toHaveLength(1);
    const [k] = set.keys;
    expect(k).toEqual({ kty: 'OKP', crv: 'Ed25519', x: expect.any(String), kid: (await doorKey(e)).kid, alg: 'EdDSA', use: 'sig' });
    expect(JSON.stringify(set)).not.toContain('"d"');
    const thumb = b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`{"crv":"Ed25519","kty":"OKP","x":"${k.x}"}`))));
    expect(k.kid).toBe(thumb);
  });

  it('signs canonical claims as a compact EdDSA JWS that verifies with the JWKS alone', async () => {
    const jws = await signJws(e, { z: 1, aud: AUD.quote, a: [2, 1] });
    expect(parts(jws).header).toEqual({ alg: 'EdDSA', kid: (await doorKey(e)).kid });
    expect(jws.split('.')[1]).toBe(b64u(enc.encode('{"a":[2,1],"aud":"lazydoor:quote","z":1}')));
    expect(await verifyWithJwks(jws, await jwks(e))).toBe(true);
    expect(await signJws(e, { aud: AUD.quote, a: [2, 1], z: 1 })).toBe(jws);
  });

  it('verifies only its own tokens for the expected audience', async () => {
    const jws = await signJws(e, { aud: AUD.receipt, orderId: 'ord_1' });
    expect(await verifyJws(e, jws, AUD.receipt)).toEqual({ aud: AUD.receipt, orderId: 'ord_1' });
    expect(await verifyJws(e, jws, AUD.quote)).toBeNull();
    const [h, p, s] = jws.split('.');
    const forged = b64u(enc.encode(canonicalJson({ aud: AUD.receipt, orderId: 'ord_2' })));
    expect(await verifyJws(e, `${h}.${forged}.${s}`, AUD.receipt)).toBeNull();
    expect(await verifyJws(e, `${b64u(enc.encode('{"alg":"none","kid":"x"}'))}.${p}.`, AUD.receipt)).toBeNull();
    expect(await verifyJws(e, `${b64u(enc.encode(canonicalJson({ alg: 'EdDSA', kid: 'someone-else' })))}.${p}.${s}`, AUD.receipt)).toBeNull();
    expect(await verifyJws(e, `${b64u(enc.encode(canonicalJson({ alg: 'EdDSA', crit: ['b64'], kid: (await doorKey(e)).kid })))}.${p}.${s}`, AUD.receipt)).toBeNull();
    for (const bad of ['', 'a.b', 'a.b.c', `${h}.${p}.${s}x`, `${h}.${p}`]) expect(await verifyJws(e, bad, AUD.receipt)).toBeNull();
  });

  it('refuses to sign without a configured key', async () => {
    await expect(signJws({ ...e, DOOR_SIGNING_JWK: '' }, { aud: AUD.quote })).rejects.toThrow('DOOR_SIGNING_JWK');
  });

  it('never echoes any part of a malformed secret in its error', async () => {
    const err = await signJws({ ...e, DOOR_SIGNING_JWK: '{"kty":"OKP","crv":"Ed25519","d":FAKEPRIVATEKEYMATERIAL}' }, { aud: AUD.quote }).catch((x: Error) => x);
    expect(String((err as Error).message)).toBe('DOOR_SIGNING_JWK is not valid JSON');
  });
});
