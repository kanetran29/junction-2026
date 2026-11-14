/** A short opaque id with a type prefix (`q_`, `d_`, `ord_`, `b_`): the prefix, `_`, then 16 hex characters of a random UUID. */
export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;

/** Hex sha256 of a string; hashes API keys, approver keys and order line sets. */
export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
