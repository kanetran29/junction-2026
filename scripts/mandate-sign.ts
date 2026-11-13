import { mkdirSync, writeFileSync } from 'node:fs';
import { defaultMandate } from '../src/domain/constants';
import { generateBuyerKeys, signMandate } from '../src/mandate/jws';

/** Renders a value as a SQL string literal, doubling single quotes. */
const lit = (v: string): string => `'${v.replaceAll("'", "''")}'`;

const KEYS_DIR = '.data/valio/keys';
const OUT = '.data/valio/build/mandates.sql';

/**
 * Generates an Ed25519 key pair per demo buyer, saves each private JWK under the gitignored `.data/valio/keys/`
 * (never printed), signs the default mandate and writes the SQL that loads `buyer_keys` and `mandates` into D1.
 */
async function main(): Promise<void> {
  mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  mkdirSync('.data/valio/build', { recursive: true });
  const sql: string[] = [];
  for (const buyerId of ['hotel-a', 'hotel-b']) {
    const keys = await generateBuyerKeys();
    writeFileSync(`${KEYS_DIR}/${buyerId}.private.jwk.json`, JSON.stringify(keys.privateJwk), { mode: 0o600 });
    const [h, p, s] = (await signMandate(defaultMandate(buyerId), keys.privateJwk)).split('.');
    const pub = JSON.stringify(keys.publicJwk);
    sql.push(
      `INSERT OR REPLACE INTO buyer_keys(buyer_id, public_key) VALUES(${lit(buyerId)}, ${lit(pub)});`,
      `INSERT OR REPLACE INTO mandates(buyer_id, payload, signature) VALUES(${lit(buyerId)}, ${lit(`${h}.${p}`)}, ${lit(s)});`,
    );
    console.log(`${buyerId}: key saved to ${KEYS_DIR}/${buyerId}.private.jwk.json, mandate signed`);
  }
  writeFileSync(OUT, `${sql.join('\n')}\n`);
  console.log(`wrote ${OUT}`);
}

await main();
