#!/usr/bin/env node
// Checks a Lazydoor event log from the outside, with nothing but Node: reads every event, recomputes the hash chain,
// then checks the door's signed audit head against its published JWKS and against the chain recomputed here.
// Usage: node scripts/verify-audit.mjs [door URL] [--head <seq>:<hash>]
//   LAZYDOOR_KEY=<judge key> when the door is not a demo door (an agent key sees only its own buyer, so the chain looks broken).
//   --head: a head you saved earlier (from a past run or a signed /v1/audit/verify); it must still be in the chain unchanged,
//   which catches events cut from the end or a log rewritten with fresh hashes.
import { createHash, webcrypto } from 'node:crypto';

const args = process.argv.slice(2);
const headAt = args.indexOf('--head');
const saved = headAt >= 0 ? args.splice(headAt, 2)[1] : null;
const door = (args[0] ?? process.env.GATEWAY_URL ?? 'https://lazydoor.lazydoor.workers.dev').replace(/\/$/, '');
const headers = process.env.LAZYDOOR_KEY ? { Authorization: `Bearer ${process.env.LAZYDOOR_KEY}` } : {};
const GENESIS = '0'.repeat(64);

/** RFC 8785-style canonical JSON of an already parsed JSON value: keys sorted by UTF-16 code units, no whitespace. */
function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
}

/** GETs JSON from the door, failing loudly on any non-200. */
async function get(path) {
  const res = await fetch(door + path, { headers });
  if (res.status !== 200) throw new Error(`${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Every event, oldest first, paging with `since`. */
async function allEvents() {
  const out = [];
  for (let since = 0; ; ) {
    const page = await get(`/v1/events?since=${since}`);
    if (!page.events.length) return out;
    out.push(...page.events);
    since = page.next;
  }
}

/** Verifies a compact EdDSA JWS with the JWKS key its kid names; returns the claims, or null. */
async function verifyJws(jws, jwks) {
  const [h, p, s] = jws.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (header.alg !== 'EdDSA' || !jwk) return null;
  const key = await webcrypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, { name: 'Ed25519' }, false, ['verify']);
  const ok = await webcrypto.subtle.verify('Ed25519', key, Buffer.from(s, 'base64url'), Buffer.from(`${h}.${p}`));
  return ok ? JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) : null;
}

const events = await allEvents();
let prev = GENESIS;
let firstBad = null;
for (const e of events) {
  const { prevHash, hash, ...covered } = e;
  const recomputed = createHash('sha256').update(prevHash + canon(covered), 'utf8').digest('hex');
  if (firstBad === null && (prevHash !== prev || recomputed !== hash)) firstBad = e.seq;
  prev = hash;
}
const head = { count: events.length, headSeq: events.at(-1)?.seq ?? null, headHash: prev };
console.log(`chain: ${events.length} events, head seq ${head.headSeq}, head ${prev.slice(0, 16)}…, ${firstBad === null ? 'every link recomputes' : `FIRST BAD SEQ ${firstBad}`}`);
let savedOk = true;
if (saved) {
  const [seq, hash] = saved.split(':');
  savedOk = events.some((e) => e.seq === Number(seq) && e.hash === hash);
  console.log(`saved head ${seq}: ${savedOk ? 'still in the chain, unchanged' : 'MISSING OR CHANGED (events cut, rewritten, or the door was reset)'}`);
}

const verify = await get('/v1/audit/verify');
const jwks = await get('/.well-known/jwks.json');
const { jws, ...signed } = verify;
const claims = await verifyJws(jws, jwks);
const signatureOk = Boolean(claims) && canon(claims) === canon({ ...signed, aud: 'lazydoor:audit' });
console.log(`door says: valid=${verify.valid}${verify.firstBadSeq ? ` firstBadSeq=${verify.firstBadSeq}` : ''}, head seq ${verify.headSeq}, checked ${verify.checkedAt}`);
console.log(`signed head: ${signatureOk ? 'signature verifies with /.well-known/jwks.json' : 'SIGNATURE DOES NOT VERIFY'}`);
const agrees = verify.count === head.count && verify.headSeq === head.headSeq && verify.headHash === head.headHash && verify.valid === (firstBad === null);
console.log(`door and this check ${agrees ? 'agree' : 'DISAGREE (events may have been added between the two reads; run again)'}`);
process.exit(firstBad === null && signatureOk && agrees && savedOk ? 0 : 1);
