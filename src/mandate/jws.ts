import { z } from 'zod';
import type { Env } from '../env';
import { MANDATE_AUD, defaultMandate, type Mandate } from '../domain/constants';

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

/** Builds the typed MANDATE_INVALID error; `why` is for logs and tests, never a secret. */
const invalid = (why: string) => new MandateError('MANDATE_INVALID', why);
const enc = new TextEncoder();

/** Encodes bytes as unpadded base64url. */
function b64u(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes unpadded base64url; throws MANDATE_INVALID on bad characters or any non-canonical encoding (re-encoding must match). */
function fromB64u(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw invalid('bad base64url');
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  } catch {
    throw invalid('bad base64url');
  }
  if (b64u(bytes) !== s) throw invalid('non-canonical base64url');
  return bytes;
}

/** Imports an Ed25519 JWK for signing or verifying; any import failure is a MANDATE_INVALID. */
async function importKey(jwk: JsonWebKey, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, [usage]);
  } catch {
    throw invalid('bad key');
  }
}

const cents = z.number().int().nonnegative();
const limits = z.object({ autoCents: cents, hardCents: cents }).refine((l) => l.autoCents <= l.hardCents);
/** Shape every signed payload must have before it is trusted as a Mandate. */
const mandateSchema = z.object({
  buyerId: z.string(),
  version: z.number().int().min(1),
  perOrder: limits,
  perDay: limits,
  noNewAllergen: z.boolean(),
  reliabilityFloor: z.number().min(0).max(1),
  reliabilityUnknown: z.enum(['allow', 'approve']),
  approver: z.object({ name: z.string().min(1) }),
  exp: z.string().refine((e) => !Number.isNaN(Date.parse(e))),
  aud: z.string(),
});

/** Generates an Ed25519 key pair for a buyer, as exportable JWKs. */
export async function generateBuyerKeys(): Promise<{ privateJwk: JsonWebKey; publicJwk: JsonWebKey }> {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return {
    privateJwk: (await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey,
    publicJwk: (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey,
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
  let good = false;
  try {
    good = await crypto.subtle.verify('Ed25519', key, sig, enc.encode(`${h}.${p}`));
  } catch {
    good = false;
  }
  if (!good) throw invalid('signature');
  try {
    payload = mandateSchema.parse(JSON.parse(new TextDecoder().decode(fromB64u(p))));
  } catch {
    throw invalid('malformed');
  }
  if (payload.aud !== ctx.aud) throw invalid('aud');
  if (ctx.buyerId !== undefined && payload.buyerId !== ctx.buyerId) throw invalid('buyerId');
  if (ctx.minVersion !== undefined && !(payload.version >= ctx.minVersion)) throw invalid('version');
  if (ctx.now.getTime() >= Date.parse(payload.exp)) throw new MandateError('MANDATE_EXPIRED', 'mandate expired');
  return payload;
}

/** Reads the stored mandate row and its public key; null when the buyer has none, errors propagate. */
async function readRow(env: Env, buyerId: string): Promise<{ jws: string; publicKey: string } | null> {
  const row = await env.DB.prepare(
    'SELECT m.payload, m.signature, k.public_key FROM mandates m JOIN buyer_keys k ON k.buyer_id = m.buyer_id WHERE m.buyer_id = ?',
  )
    .bind(buyerId)
    .first<{ payload: string; signature: string; public_key: string }>();
  return row ? { jws: `${row.payload}.${row.signature}`, publicKey: row.public_key } : null;
}

/** Parses a stored public key JSON; unparseable is MANDATE_INVALID. */
function parseKey(json: string): JsonWebKey {
  try {
    return JSON.parse(json) as JsonWebKey;
  } catch {
    throw invalid('bad stored key');
  }
}

/** Upserts a buyer's public key and mandate (`payload` = header.payload, `signature` = the last part) in one batch. */
async function writeRow(env: Env, buyerId: string, publicJwk: JsonWebKey, jws: string): Promise<void> {
  const [h, p, s] = jws.split('.');
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO buyer_keys(buyer_id, public_key) VALUES(?, ?) ON CONFLICT(buyer_id) DO UPDATE SET public_key = excluded.public_key',
    ).bind(buyerId, JSON.stringify(publicJwk)),
    env.DB.prepare(
      'INSERT INTO mandates(buyer_id, payload, signature) VALUES(?, ?, ?) ON CONFLICT(buyer_id) DO UPDATE SET payload = excluded.payload, signature = excluded.signature',
    ).bind(buyerId, `${h}.${p}`, s),
  ]);
}

/**
 * Verifies and upserts a buyer's mandate and public key against the gateway audience. Refuses a version older than
 * the stored one (rollback guard); only "no stored row" means no floor, an unreadable stored row refuses the save.
 */
export async function saveMandate(env: Env, buyerId: string, jws: string, publicJwk: JsonWebKey): Promise<void> {
  const prev = await readRow(env, buyerId);
  let minVersion: number | undefined;
  if (prev) {
    const stored = parseStoredPayload(prev.jws);
    minVersion = stored.version;
  }
  // exp is irrelevant when storing: an expired mandate is stored but never loads
  await verifyMandate(jws, publicJwk, { now: new Date(0), aud: MANDATE_AUD, buyerId, minVersion });
  await writeRow(env, buyerId, publicJwk, jws);
}

/** Reads the version of an already stored token's payload; throws MANDATE_INVALID when it cannot be parsed. */
function parseStoredPayload(jws: string): Mandate {
  try {
    return mandateSchema.parse(JSON.parse(new TextDecoder().decode(fromB64u(jws.split('.')[1]))));
  } catch {
    throw invalid('stored mandate unreadable');
  }
}

/** Loads a buyer's stored mandate, verified against its stored key, the given audience and clock; typed error otherwise. */
export async function loadMandate(env: Env, buyerId: string, ctx: { now: Date; aud: string }): Promise<Mandate> {
  const row = await readRow(env, buyerId);
  if (!row) throw invalid('no mandate');
  return verifyMandate(row.jws, parseKey(row.publicKey), { ...ctx, buyerId });
}

/**
 * Seeds a buyer with a fresh key pair and a signed default mandate (plus overrides; `perOrder`/`perDay` merge field by field),
 * for `/admin/reset` and tests. With `tamper` one payload byte is flipped after signing so the stored mandate fails
 * verification. The private key is discarded, never returned.
 */
export async function seedMandate(
  env: Env,
  buyerId: string,
  overrides: Partial<Omit<Mandate, 'perOrder' | 'perDay'>> & { perOrder?: Partial<Mandate['perOrder']>; perDay?: Partial<Mandate['perDay']> } = {},
  opts: { tamper?: boolean } = {},
): Promise<void> {
  const base = defaultMandate(buyerId);
  const m: Mandate = {
    ...base,
    ...overrides,
    buyerId,
    perOrder: { ...base.perOrder, ...overrides.perOrder },
    perDay: { ...base.perDay, ...overrides.perDay },
  };
  const keys = await generateBuyerKeys();
  const jws = await signMandate(m, keys.privateJwk);
  if (!opts.tamper) return saveMandate(env, buyerId, jws, keys.publicJwk);
  const [h, p, s] = jws.split('.');
  const flipped = p.slice(0, 10) + (p[10] === 'A' ? 'B' : 'A') + p.slice(11);
  await writeRow(env, buyerId, keys.publicJwk, `${h}.${flipped}.${s}`);
}
