import { FAMILY_NAMES } from '../src/catalog/subtypes';

export interface CategoryTag {
  category: string;
  name: string;
}

const MAX_NAME = 40;
const BATCH = 40;
const SAMPLES = 10;

/**
 * Turns Gemini's JSON answer into `category_names` rows: keeps only well-formed `{ category, name }` entries whose
 * code exists in the index, trims names, rejects empty or over-long ones and keeps the first entry per category.
 */
export function parseCategoryTags(json: unknown, knownCodes: Set<string>): CategoryTag[] {
  if (!Array.isArray(json)) return [];
  const seen = new Set<string>();
  const out: CategoryTag[] = [];
  for (const item of json) {
    if (typeof item !== 'object' || item === null) continue;
    const { category, name } = item as { category?: unknown; name?: unknown };
    if (typeof category !== 'string' || typeof name !== 'string' || !knownCodes.has(category) || seen.has(category)) continue;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > MAX_NAME) continue;
    seen.add(category);
    out.push({ category, name: trimmed });
  }
  return out;
}

const sqlStr = (s: string): string => `'${s.replaceAll("'", "''")}'`;

/** Renders the rows as one DELETE plus one multi-row INSERT for `category_names`. */
export function categoriesSql(rows: (CategoryTag & { tagSource: 'reviewed' | 'model' })[]): string {
  const tuples = rows.map((r) => `(${sqlStr(r.category)},${sqlStr(r.name)},${sqlStr(r.tagSource)})`);
  return `DELETE FROM category_names;\nINSERT INTO category_names (category,names,tag_source) VALUES ${tuples.join(',')};\n`;
}

/**
 * Asks Gemini for a short English family name for each category in one batch and returns the parsed rows plus the
 * request's token usage; the response is schema-constrained JSON, and a failed request is retried once.
 */
async function nameBatch(
  batch: { category: string; samples: string[] }[],
  known: Set<string>,
  model: string,
  key: string,
): Promise<{ tags: CategoryTag[]; tokens: number }> {
  const prompt =
    'Each item is a product category code from a Finnish wholesale food catalogue with sample product names. ' +
    'Give each category a short English family name (1-4 words, e.g. "Drinking milk", "Napkins") that a buyer would use. ' +
    'Return one { category, name } per item, with the category code unchanged.\n' +
    JSON.stringify(batch);
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: { type: 'OBJECT', properties: { category: { type: 'STRING' }, name: { type: 'STRING' } }, required: ['category', 'name'] },
      },
    },
  };
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { totalTokenCount?: number } };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
      return { tags: parseCategoryTags(JSON.parse(text), known), tokens: data.usageMetadata?.totalTokenCount ?? 0 };
    } catch (e) {
      if (attempt >= 1) throw e;
    }
  }
}

/** Reads the Valio products and `.dev.vars`, names every category through Gemini and writes `.data/valio/build/categories.sql`. */
async function main(): Promise<void> {
  const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
  const dir = '.data/valio';
  const key = /^GEMINI_API_KEY=(.+)$/m.exec(readFileSync('.dev.vars', 'utf8'))?.[1].trim().replace(/^"|"$/g, '');
  if (!key) throw new Error('GEMINI_API_KEY missing from .dev.vars');
  const model = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';

  const products = JSON.parse(readFileSync(`${dir}/data/product_data.json`, 'utf8')) as { category: string; synkkaData: { names?: { language: string; value: string }[] } }[];
  const samples = new Map<string, string[]>();
  for (const p of products) {
    const list = samples.get(p.category) ?? [];
    if (list.length < SAMPLES) list.push((p.synkkaData.names ?? []).map((n) => n.value).filter(Boolean).join(' / '));
    samples.set(p.category, list);
  }
  const known = new Set(samples.keys());
  const items = [...samples].map(([category, s]) => ({ category, samples: s }));

  const t0 = Date.now();
  let tokens = 0;
  const named = new Map<string, { name: string; tagSource: 'reviewed' | 'model' }>();
  for (let i = 0; i < items.length; i += BATCH) {
    const r = await nameBatch(items.slice(i, i + BATCH), known, model, key);
    tokens += r.tokens;
    for (const t of r.tags) named.set(t.category, { name: t.name, tagSource: 'model' });
  }
  for (const [category, name] of Object.entries(FAMILY_NAMES)) if (known.has(category)) named.set(category, { name, tagSource: 'reviewed' });

  const rows = [...named].map(([category, v]) => ({ category, ...v }));
  mkdirSync(`${dir}/build`, { recursive: true });
  writeFileSync(`${dir}/build/categories.sql`, categoriesSql(rows));
  console.log(`${items.length} categories, ${rows.length} named, ${tokens} tokens, ${Date.now() - t0} ms, model ${model} -> ${dir}/build/categories.sql`);
}

const entry = (globalThis as { process?: { argv?: string[] } }).process?.argv?.[1];
if (entry && entry.endsWith('tag-categories.ts')) await main();
