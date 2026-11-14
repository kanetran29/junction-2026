/** A short opaque id with a type prefix (`q_`, `d_`, `ord_`, `b_`): the prefix, `_`, then 16 hex characters of a random UUID. */
export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;

/** Hex sha256 of a string; hashes API keys, approver keys and order line sets. */
export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Unpadded base64url of bytes (JWS segments, tokens). */
export function b64u(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes unpadded base64url, or null for bad characters or any non-canonical encoding (re-encoding must give the input back). */
export function fromB64u(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  return b64u(bytes) === s ? bytes : null;
}

/**
 * Canonical JSON in the RFC 8785 (JCS) style: the value goes through a JSON round trip first (so `toJSON`, `undefined` and
 * non-finite numbers behave exactly as in JSON.stringify), then object keys are sorted by UTF-16 code units at every depth,
 * arrays keep their order, there is no whitespace, and strings and numbers are written as ECMAScript JSON.stringify writes them.
 */
export function canonicalJson(v: unknown): string {
  const json = JSON.stringify(v);
  if (json === undefined) throw new Error('canonicalJson: not a JSON value');
  return canon(JSON.parse(json));
}

/** Writes an already JSON-parsed value canonically (see `canonicalJson`). */
function canon(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
}
