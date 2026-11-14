/**
 * Turns a recorded Valio reply file (`{ availability: [reply], price: [reply] }`, one reply per call) into
 * `.data/valio/build/replies.sql`: one `valio_replies` row per product and kind, keyed by the recording name
 * (the file name without `.json`). Load it with `pnpm replies:load`.
 */
const lit = (v: string | null): string => (v === null ? 'NULL' : `'${v.replaceAll("'", "''")}'`);

interface Reply {
  timeNow?: string;
  products: { productId: string }[];
}

/** Renders the recording as DELETE + INSERT statements, packed under D1's statement size limit. */
export function replyStatements(recording: string, kinds: { availability: Reply[]; price: Reply[] }, maxChars = 60_000): string[] {
  const head = 'INSERT OR REPLACE INTO valio_replies (recording,kind,product_id,body,time_now) VALUES ';
  const tuples = (['availability', 'price'] as const).flatMap((kind) =>
    kinds[kind].flatMap((reply) =>
      reply.products.map((p) => `(${[recording, kind, p.productId, JSON.stringify(p), reply.timeNow ?? null].map(lit).join(',')})`),
    ),
  );
  const out = [`DELETE FROM valio_replies WHERE recording = ${lit(recording)}`];
  let cur: string[] = [];
  let size = head.length;
  for (const t of tuples) {
    if (cur.length && size + t.length > maxChars) {
      out.push(head + cur.join(','));
      cur = [];
      size = head.length;
    }
    cur.push(t);
    size += t.length + 1;
  }
  if (cur.length) out.push(head + cur.join(','));
  return out;
}

/** Reads the recording (default `.data/valio/recordings/replies_2026-11-16.json`) and writes the SQL file. */
async function main(): Promise<void> {
  const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
  const path = process.argv[2] ?? '.data/valio/recordings/replies_2026-11-16.json';
  const recording = path.split('/').pop()!.replace(/\.json$/, '');
  const statements = replyStatements(recording, JSON.parse(readFileSync(path, 'utf8')));
  mkdirSync('.data/valio/build', { recursive: true });
  writeFileSync('.data/valio/build/replies.sql', statements.map((s) => `${s};\n`).join(''));
  console.log(`${recording}: ${statements.length - 1} insert statements -> .data/valio/build/replies.sql`);
}

const entry = (globalThis as { process?: { argv?: string[] } }).process?.argv?.[1];
if (entry && entry.endsWith('load-replies.ts')) await main();
