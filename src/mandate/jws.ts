import type { Env } from '../env';
import { defaultMandate, type Mandate } from '../domain/constants';

/** Typed failure of mandate verification: MANDATE_INVALID (bad token, signature, aud, buyer, version) or MANDATE_EXPIRED. */
export class MandateError extends Error {
  constructor(
    readonly code: 'MANDATE_INVALID' | 'MANDATE_EXPIRED',
    message: string,
  ) {
    super(message);
    this.name = 'MandateError';
  }
}

const invalid = (why: string) => new MandateError('MANDATE_INVALID', why);
const enc = new TextEncoder();

/** Encodes bytes as unpadded base64url. */
function b64u(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes unpadded base64url; throws MANDATE_INVALID on characters outside the alphabet. */
function fromB64u(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw invalid('bad base64url');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Imports an Ed25519 JWK for signing or verifying; any import failure is a MANDATE_INVALID. */
async function importKey(jwk: JsonWebKey, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, [usage]);
  } catch {
    throw invalid('bad key');
  }
}

/** Generates an Ed25519 key pair for a buyer, as exportable JWKs. */
export async function generateBuyerKeys(): Promise<{ privateJwk: JsonWebKey; publicJwk: JsonWebKey }> {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return {
    privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey),
    publicJwk: await crypto.subtle.exportKey('jwk', kp.publicKey),
  };
}

/** Signs a mandate as a compact JWS (`alg: EdDSA`, `kid` = buyerId) so the gateway can prove the limits came from the buyer. */
export async function signMandate(m: Mandate, privateJwk: JsonWebKey): Promise<string> {
  const header = b64u(enc.encode(JSON.stringify({ alg: 'EdDSA', kid: m.buyerId })));
  const input = `${header}.${b64u(enc.encode(JSON.stringify(m)))}`;
  const sig = await crypto.subtle.sign('Ed25519', await importKey(privateJwk, 'sign'), enc.encode(input));
  return `${input}.${b64u(new Uint8Array(sig))}`;
}

/**
 * Verifies a mandate JWS and returns it. Only `alg: EdDSA` is accepted (never `none`); the signature is checked
 * before the payload is trusted. Throws MANDATE_INVALID for malformed tokens, bad signature, wrong `aud`, wrong
 * `buyerId` (when given) or a version below `minVersion` (rollback guard), and MANDATE_EXPIRED when `now >= exp`.
 */
export async function verifyMandate(
  jws: string,
  publicJwk: JsonWebKey,
  ctx: { now: Date; aud: string; buyerId?: string; minVersion?: number },
): Promise<Mandate> {
  const parts = jws.split('.');
  if (parts.length !== 3) throw invalid('malformed');
  const [h, p, s] = parts;
  let header: { alg?: unknown };
  let payload: Mandate;
  let sig: Uint8Array;
  try {
    header = JSON.parse(new TextDecoder().decode(fromB64u(h)));
    sig = fromB64u(s);
  } catch {
    throw invalid('malformed');
  }
  if (header?.alg !== 'EdDSA') throw invalid('alg');
  const key = await importKey(publicJwk, 'verify');
  if (!(await crypto.subtle.verify('Ed25519', key, sig, enc.encode(`${h}.${p}`)))) throw invalid('signature');
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64u(p)));
  } catch {
    throw invalid('malformed');
  }
  if (payload.aud !== ctx.aud) throw invalid('aud');
  if (ctx.buyerId !== undefined && payload.buyerId !== ctx.buyerId) throw invalid('buyerId');
  if (ctx.minVersion !== undefined && !(payload.version >= ctx.minVersion)) throw invalid('version');
  const exp = Date.parse(payload.exp);
  if (Number.isNaN(exp)) throw invalid('exp');
  if (ctx.now.getTime() >= exp) throw new MandateError('MANDATE_EXPIRED', 'mandate expired');
  return payload;
}

/** Reads the stored mandate row and its public key, or throws MANDATE_INVALID when the buyer has none. */
async function readRow(env: Env, buyerId: string) {
  const row = await env.DB.prepare(
    'SELECT m.payload, m.signature, k.public_key FROM mandates m JOIN buyer_keys k ON k.buyer_id = m.buyer_id WHERE m.buyer_id = ?',
  )
    .bind(buyerId)
    .first<{ payload: string; signature: string; public_key: string }>();
  if (!row) throw invalid('no mandate');
  return { jws: `${row.payload}.${row.signature}`, publicJwk: JSON.parse(row.public_key) as JsonWebKey };
}

/**
 * Verifies and upserts a buyer's mandate and public key (`payload` = header.payload, `signature` = the signature part).
 * Refuses a version older than the stored one, so a captured old mandate cannot be replayed over a newer one.
 */
export async function saveMandate(env: Env, buyerId: string, jws: string, publicJwk: JsonWebKey): Promise<void> {
  const parts = jws.split('.');
  let minVersion: number | undefined;
  try {
    const prev = await readRow(env, buyerId);
    const stored = JSON.parse(new TextDecoder().decode(fromB64u(prev.jws.split('.')[1]))) as Mandate;
    minVersion = stored.version;
  } catch {
    minVersion = undefined;
  }
  // exp is irrelevant when storing: an expired mandate is stored but never loads
  await verifyMandate(jws, publicJwk, { now: new Date(0), aud: parsedAud(parts), buyerId, minVersion });
  await env.DB.batch([
    env.DB.prepare('INSERT INTO buyer_keys(buyer_id, public_key) VALUES(?, ?) ON CONFLICT(buyer_id) DO UPDATE SET public_key = excluded.public_key').bind(
      buyerId,
      JSON.stringify(publicJwk),
    ),
    env.DB.prepare('INSERT INTO mandates(buyer_id, payload, signature) VALUES(?, ?, ?) ON CONFLICT(buyer_id) DO UPDATE SET payload = excluded.payload, signature = excluded.signature').bind(
      buyerId,
      `${parts[0]}.${parts[1]}`,
      parts[2],
    ),
  ]);
}

/** Reads the (untrusted) aud claim of a token so saveMandate can verify against whatever audience it was signed for. */
function parsedAud(parts: string[]): string {
  try {
    return (JSON.parse(new TextDecoder().decode(fromB64u(parts[1]))) as Mandate).aud;
  } catch {
    throw invalid('malformed');
  }
}

/** Loads a buyer's stored mandate, verified against its stored key, the given audience and clock; typed error otherwise. */
export async function loadMandate(env: Env, buyerId: string, ctx: { now: Date; aud: string }): Promise<Mandate> {
  const { jws, publicJwk } = await readRow(env, buyerId);
  return verifyMandate(jws, publicJwk, { ...ctx, buyerId });
}

/**
 * Seeds a buyer with a fresh key pair and a signed default mandate (plus overrides), for `/admin/reset` and tests.
 * With `tamper` one payload byte is flipped after signing so the stored mandate fails verification (demo of tamper detection).
 * Returns the private JWK so the caller can sign a later version; it must never be logged.
 */
export async function seedMandate(
  env: Env,
  buyerId: string,
  overrides: Partial<Mandate> = {},
  opts: { tamper?: boolean } = {},
): Promise<{ privateJwk: JsonWebKey; publicJwk: JsonWebKey }> {
  const keys = await generateBuyerKeys();
  const jws = await signMandate({ ...defaultMandate(buyerId), ...overrides, buyerId }, keys.privateJwk);
  if (!opts.tamper) {
    await saveMandate(env, buyerId, jws, keys.publicJwk);
    return keys;
  }
  const [h, p, s] = jws.split('.');
  const flipped = p.slice(0, 10) + (p[10] === 'A' ? 'B' : 'A') + p.slice(11);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO buyer_keys(buyer_id, public_key) VALUES(?, ?) ON CONFLICT(buyer_id) DO UPDATE SET public_key = excluded.public_key').bind(
      buyerId,
      JSON.stringify(keys.publicJwk),
    ),
    env.DB.prepare('INSERT INTO mandates(buyer_id, payload, signature) VALUES(?, ?, ?) ON CONFLICT(buyer_id) DO UPDATE SET payload = excluded.payload, signature = excluded.signature').bind(
      buyerId,
      `${h}.${flipped}`,
      s,
    ),
  ]);
  return keys;
}
