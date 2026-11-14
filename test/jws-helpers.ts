import { fromB64u } from '../src/util';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** The decoded header and claims of a compact JWS (no checking). */
export function decodeJws(jws: string): { header: Record<string, unknown>; claims: Record<string, unknown> } {
  const [h, p] = jws.split('.');
  return { header: JSON.parse(dec.decode(fromB64u(h)!)), claims: JSON.parse(dec.decode(fromB64u(p)!)) };
}

/** Verifies a compact JWS with only a published JWK Set, as an outside client would: pick the key by `kid`, check EdDSA. */
export async function verifyWithJwks(jws: string, set: { keys: JsonWebKey[] }): Promise<boolean> {
  const [h, p, s] = jws.split('.');
  const { header } = decodeJws(jws);
  const jwk = set.keys.find((k) => (k as { kid?: string }).kid === header.kid);
  if (!jwk || header.alg !== 'EdDSA') return false;
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify('Ed25519', key, fromB64u(s)!, enc.encode(`${h}.${p}`));
}
