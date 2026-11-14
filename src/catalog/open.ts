import type { Env } from '../env';
import { getByGtin, getProducts, normBrand, type CatalogProduct } from './search';
import { FAMILY_NAMES } from './subtypes';

export type ResolveInput = { productId: string } | { gtin: string } | { brand: string } | { name: string };

export interface ResolveReply {
  status: 'RESOLVED' | 'AMBIGUOUS' | 'NO_MATCH' | 'BRAND_NOT_CARRIED' | 'TYPE_RESOLVED';
  product?: { id: string; salesUnit: string | null; content: object | null; name: string | null; brand: string | null };
  brand?: string;
  didYouMean?: string[];
  candidates?: { id: string; unitId?: string; salesUnit: string | null; name: string | null; category?: string; subtype?: string | null }[];
  category?: string;
  subtype?: string | null;
  valioCalls: 0;
}

const MAX_CANDIDATES = 20;
/** A product's display name: English, else Finnish, else its first name, else null. */
const nameOf = (p: CatalogProduct) => (p.names.find((n) => n.language === 'en') ?? p.names.find((n) => n.language === 'fi') ?? p.names[0])?.value ?? null;
/** The product facts a resolve reply shows: id, sales unit, content, name and brand. */
const toProduct = (p: CatalogProduct) => ({ id: p.id, salesUnit: p.salesUnit, content: p.nameContent, name: nameOf(p), brand: p.brand });
/** The short form of a product listed as one of several candidates for an ambiguous input. */
const toCandidate = (p: CatalogProduct) => ({ id: p.id, salesUnit: p.salesUnit, name: nameOf(p) });

/** True when `a` and `b` are at most one insertion, deletion or substitution apart (Levenshtein distance 1). */
function withinOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) || a.slice(i) === b.slice(i + 1);
}

/** Resolves a brand to its display spelling, or reports it as not carried with near spellings; never corrects the input. */
async function resolveBrand(env: Env, brand: string): Promise<ResolveReply> {
  const { results } = await env.DB.prepare("SELECT brand, brand_norm, COUNT(*) AS n FROM products WHERE brand_norm <> '' GROUP BY brand_norm, brand").all<{ brand: string; brand_norm: string; n: number }>();
  const display = new Map<string, { brand: string; n: number }>();
  for (const r of results) {
    const best = display.get(r.brand_norm);
    if (!best || r.n > best.n) display.set(r.brand_norm, { brand: r.brand, n: r.n });
  }
  const norm = normBrand(brand);
  const hit = display.get(norm);
  if (hit) return { status: 'RESOLVED', brand: hit.brand, valioCalls: 0 };
  const didYouMean = [...display].filter(([n]) => withinOne(norm, n)).map(([, v]) => v.brand).sort();
  return { status: 'BRAND_NOT_CARRIED', didYouMean, valioCalls: 0 };
}

/** Resolves a name: an exact name match first, then an all-token match that must land in one category and subtype. */
async function resolveName(env: Env, name: string): Promise<ResolveReply> {
  const wanted = name.trim().toLowerCase();
  const exact = await env.DB.prepare("SELECT id FROM products WHERE EXISTS (SELECT 1 FROM json_each(products.names) WHERE lower(trim(json_extract(value, '$.value'))) = ?) ORDER BY id").bind(wanted).all<{ id: string }>();
  if (exact.results.length) {
    const found = await getProducts(env, exact.results.map((r) => r.id));
    return found.length === 1 ? { status: 'RESOLVED', product: toProduct(found[0]), valioCalls: 0 } : { status: 'AMBIGUOUS', candidates: found.slice(0, MAX_CANDIDATES).map(toCandidate), valioCalls: 0 };
  }
  const tokens = wanted.split(/\s+/).filter(Boolean);
  if (!tokens.length) return { status: 'NO_MATCH', valioCalls: 0 };
  const where = tokens.map(() => "EXISTS (SELECT 1 FROM json_each(products.names) WHERE lower(json_extract(value, '$.value')) LIKE ? ESCAPE '\\')").join(' AND ');
  const args = tokens.map((t) => `%${t.replace(/[\\%_]/g, '\\$&')}%`);
  const { results } = await env.DB.prepare(`SELECT id, category, subtype FROM products WHERE ${where} ORDER BY id`).bind(...args).all<{ id: string; category: string; subtype: string | null }>();
  if (!results.length) return { status: 'NO_MATCH', valioCalls: 0 };
  const types = new Set(results.map((r) => `${r.category}|${r.subtype ?? ''}`));
  if (types.size === 1) return { status: 'TYPE_RESOLVED', category: results[0].category, subtype: results[0].subtype, valioCalls: 0 };
  const seen = new Set<string>();
  const firstOfType = results.filter((r) => {
    const key = `${r.category}|${r.subtype ?? ''}`;
    return !seen.has(key) && seen.add(key);
  });
  return { status: 'AMBIGUOUS', candidates: firstOfType.slice(0, MAX_CANDIDATES).map((r) => ({ id: r.id, salesUnit: null, name: null, category: r.category, subtype: r.subtype })), valioCalls: 0 };
}

/**
 * Turns what a buyer has (a product id, a sales-unit GTIN, a brand or a name) into catalogue facts, from the local index only.
 * It never corrects the input: unknown or ambiguous input is reported with candidates for the agent or buyer to choose.
 */
export async function resolve(env: Env, input: ResolveInput): Promise<ResolveReply> {
  if ('productId' in input) {
    const [p] = await getProducts(env, [input.productId]);
    return p ? { status: 'RESOLVED', product: toProduct(p), valioCalls: 0 } : { status: 'NO_MATCH', valioCalls: 0 };
  }
  if ('gtin' in input) {
    const hits = await getByGtin(env, input.gtin);
    const { results } = await env.DB.prepare('SELECT product_id, unit_id FROM product_gtins WHERE gtin = ? ORDER BY product_id').bind(input.gtin).all<{ product_id: string; unit_id: string }>();
    const shared = results.some((r) => r.product_id !== hits[0]?.id) || results.filter((r) => r.product_id === hits[0]?.id).length > 1;
    if (hits.length === 1 && !shared) return { status: 'RESOLVED', product: toProduct(hits[0]), valioCalls: 0 };
    if (!hits.length && !results.length) return { status: 'NO_MATCH', valioCalls: 0 };
    const rows = [...results.map((r) => ({ id: r.product_id, unitId: r.unit_id as string | undefined })), ...hits.filter((h) => !results.some((r) => r.product_id === h.id)).map((h) => ({ id: h.id, unitId: undefined }))];
    const found = await getProducts(env, rows.map((r) => r.id));
    const candidates = rows.map((r) => {
      const p = found.find((f) => f.id === r.id);
      return { id: r.id, unitId: r.unitId, salesUnit: p?.salesUnit ?? null, name: p ? nameOf(p) : null };
    });
    return { status: 'AMBIGUOUS', candidates, valioCalls: 0 };
  }
  return 'brand' in input ? resolveBrand(env, input.brand) : resolveName(env, input.name);
}

export interface Family {
  category: string;
  name: string | null;
  subtypes: string[];
  claims: string[];
  productCount: number;
  tagSource: 'reviewed' | 'model';
  evidence?: { terms: string[]; mentions: number; of: number };
}

/**
 * The catalogue map: every category with its subtypes, claims and size. With `terms`, only categories of at least three
 * products whose marketing text mentions a term, ranked by how many products do. Shows evidence, never products or quantities.
 */
export async function listFamilies(env: Env, terms: string[]): Promise<Family[]> {
  const lowered = terms.map((t) => t.trim().toLowerCase()).filter(Boolean);
  const mention = lowered.length ? `SUM(CASE WHEN ${lowered.map(() => 'instr(p.search_text, ?) > 0').join(' OR ')} THEN 1 ELSE 0 END)` : '0';
  const { results } = await env.DB.prepare(
    `SELECT p.category AS category, c.names AS name, c.tag_source AS tag_source, COUNT(*) AS n, ${mention} AS mentions,
       (SELECT json_group_array(DISTINCT subtype) FROM products WHERE category = p.category AND subtype IS NOT NULL) AS subtypes,
       (SELECT json_group_array(DISTINCT j.value) FROM products x, json_each(x.claims) j WHERE x.category = p.category) AS claims
     FROM products p LEFT JOIN category_names c ON c.category = p.category GROUP BY p.category`,
  )
    .bind(...lowered)
    .all<{ category: string; name: string | null; tag_source: 'reviewed' | 'model' | null; n: number; mentions: number; subtypes: string; claims: string }>();
  const families = results
    .filter((r) => !lowered.length || (r.n >= 3 && r.mentions > 0))
    .map((r): Family => ({
      category: r.category,
      name: r.name ?? FAMILY_NAMES[r.category] ?? null,
      subtypes: (JSON.parse(r.subtypes) as string[]).sort(),
      claims: (JSON.parse(r.claims) as string[]).sort(),
      productCount: r.n,
      tagSource: r.tag_source ?? (FAMILY_NAMES[r.category] ? 'reviewed' : 'model'),
      ...(lowered.length ? { evidence: { terms: lowered, mentions: r.mentions, of: r.n } } : {}),
    }));
  const byCategory = (a: Family, b: Family) => (a.category < b.category ? -1 : 1);
  if (!lowered.length) return families.sort(byCategory);
  return families.sort((a, b) => b.evidence!.mentions - a.evidence!.mentions || b.evidence!.mentions / b.evidence!.of - a.evidence!.mentions / a.evidence!.of || byCategory(a, b));
}
