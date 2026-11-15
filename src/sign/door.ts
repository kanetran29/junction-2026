import type { Env } from '../env';
import { b64u, canonicalJson, fromB64u } from '../util';

/** The audience of each kind of statement the door signs, so a signature over one kind is never accepted as another. */
export const AUD = { quote: 'lazydoor:quote', receipt: 'lazydoor:receipt', audit: 'lazydoor:audit', cancellation: 'lazydoor:cancellation' } as const;

/** The door's signing key: its RFC 7638 thumbprint (`kid`), the public JWK it publishes, and the imported key pair. */
export interface DoorKey {
  kid: string;
  publicJwk: { kty: 'OKP'; crv: 'Ed25519'; x: string; kid: string; alg: 'EdDSA'; use: 'sig' };
  sign: CryptoKey;
  verify: CryptoKey;
}

const enc = new TextEncoder();
let cached: { secret: string; key: Promise<DoorKey> } | null = null;

/**
 * Loads the private Ed25519 JWK from the `DOOR_SIGNING_JWK` secret, derives the public key and its RFC 7638 thumbprint
 * (`kid`, so a second key can be published beside it for rotation) and checks that the pair signs and verifies.
 */
async function load(secret: string): Promise<DoorKey> {
  let jwk: JsonWebKey;
  try {
    jwk = JSON.parse(secret) as JsonWebKey;
  } catch {
    // a JSON.parse message quotes the text around the error, which here is private key material
    throw new Error('DOOR_SIGNING_JWK is not valid JSON');
  }
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string' || typeof jwk.d !== 'string') throw new Error('DOOR_SIGNING_JWK must be a private Ed25519 JWK');
  const pub = { kty: 'OKP' as const, crv: 'Ed25519' as const, x: jwk.x };
  const kid = b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(canonicalJson(pub)))));
  const sign = await crypto.subtle.importKey('jwk', { ...pub, d: jwk.d }, { name: 'Ed25519' }, false, ['sign']);
  const verify = await crypto.subtle.importKey('jwk', pub, { name: 'Ed25519' }, false, ['verify']);
  const probe = enc.encode('lazydoor key check');
  if (!(await crypto.subtle.verify('Ed25519', verify, await crypto.subtle.sign('Ed25519', sign, probe), probe))) throw new Error('DOOR_SIGNING_JWK: d does not match x');
  return { kid, publicJwk: { ...pub, kid, alg: 'EdDSA', use: 'sig' }, sign, verify };
}

/** The door's key from the `DOOR_SIGNING_JWK` secret (loaded once per secret value); a missing or unusable secret throws. */
export function doorKey(env: Env): Promise<DoorKey> {
  const secret = env.DOOR_SIGNING_JWK;
  if (!secret) return Promise.reject(new Error('DOOR_SIGNING_JWK is not configured'));
  if (cached?.secret !== secret) cached = { secret, key: load(secret) };
  return cached.key;
}

/** The public JWK Set served at `/.well-known/jwks.json`: the door's one Ed25519 key, never its private part. */
export async function jwks(env: Env): Promise<{ keys: DoorKey['publicJwk'][] }> {
  return { keys: [(await doorKey(env)).publicJwk] };
}

/**
 * Signs claims as a compact JWS with header `{"alg":"EdDSA","kid":…}`. Header and payload are canonical JSON, and Ed25519
 * is deterministic, so the same claims always give the same token.
 */
export async function signJws(env: Env, claims: { aud: string } & Record<string, unknown>): Promise<string> {
  const k = await doorKey(env);
  const input = `${b64u(enc.encode(canonicalJson({ alg: 'EdDSA', kid: k.kid })))}.${b64u(enc.encode(canonicalJson(claims)))}`;
  return `${input}.${b64u(new Uint8Array(await crypto.subtle.sign('Ed25519', k.sign, enc.encode(input))))}`;
}

/** Parses JSON bytes to a plain object, or null. */
function objectOf(bytes: Uint8Array | null): Record<string, unknown> | null {
  if (!bytes) return null;
  try {
    const v = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Verifies a compact JWS the door signed and returns its claims, or null. The header must be exactly `alg: EdDSA` and the
 * door's own `kid` (no `none`, no other key, no `crit` or other header fields); the signature is checked before the payload
 * is read, and the payload's `aud` must be the expected one.
 */
export async function verifyJws(env: Env, jws: string, aud: string): Promise<Record<string, unknown> | null> {
  const segments = typeof jws === 'string' ? jws.split('.') : [];
  if (segments.length !== 3) return null;
  const [h, p, s] = segments;
  const header = objectOf(fromB64u(h));
  const sig = fromB64u(s);
  const k = await doorKey(env);
  if (!header || !sig || Object.keys(header).length !== 2 || header.alg !== 'EdDSA' || header.kid !== k.kid) return null;
  let good = false;
  try {
    good = await crypto.subtle.verify('Ed25519', k.verify, sig, enc.encode(`${h}.${p}`));
  } catch {
    good = false;
  }
  if (!good) return null;
  const claims = objectOf(fromB64u(p));
  return claims && claims.aud === aud ? claims : null;
}
