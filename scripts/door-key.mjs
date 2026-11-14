#!/usr/bin/env node
// Generates the door's Ed25519 signing key as a private JWK, writes it to the given file (mode 600, never overwritten) and
// prints only its kid (RFC 7638 thumbprint). Load it with `wrangler secret put DOOR_SIGNING_JWK < <file>`, or for local dev
// add DOOR_SIGNING_JWK=<the file's one line> to .dev.vars. The private key is never printed.
// Usage: node scripts/door-key.mjs <file>
import { createHash, generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/door-key.mjs <file>');
  process.exit(1);
}
const jwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
writeFileSync(file, JSON.stringify(jwk), { mode: 0o600, flag: 'wx' });
const kid = createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x })).digest('base64url');
console.log(`wrote ${file}; kid ${kid}`);
