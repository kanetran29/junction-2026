import type { Env } from '../env';

export interface NameContent {
  count: number;
  size: number;
  unit: string;
  total: number;
  totalUnit: 'l' | 'kg';
}

export interface CatalogProduct {
  id: string;
  category: string;
  subtype: string | null;
  tagSource: 'reviewed' | 'model';
  names: { language: string; value: string }[];
  salesUnit: string | null;
  baseUnit: string | null;
  unitsPerSales: number | null;
  lotStep: number | null;
  tempClass: number | null;
  claims: string[];
  allergens: { contains: string[]; mayContain: string[]; freeFrom: string[] };
  labels: string[];
  brand: string | null;
  brandNorm: string;
  salesUnitGtin: string | null;
  gtin: string | null;
  units: { unitId: string; gtin?: string; sizeInBaseUnits: number }[];
  origin: string | null;
  reliability: number | null;
  carbon: number | null;
  substitutes: string[];
  variableWeight: boolean;
  nameContent: NameContent | null;
  searchText: string;
}

export interface SearchFilter {
  category: string;
  claims: string[];
  subtype?: string;
  tempClasses?: number[];
  brand?: { rule: 'only' | 'prefer'; names: string[] };
}

type Row = Record<string, string | number | null>;

/** Lowercases and keeps only letters and digits, so "Arla ", "ARLA" and "arla" compare equal (the oracle's brand rule). */
export function normBrand(s: string | null | undefined): string {
  return Array.from((s ?? '').toLowerCase())
    .filter((ch) => /[\p{L}\p{N}]/u.test(ch))
    .join('');
}

const json = <T>(v: string | number | null, fallback: T): T => (v === null ? fallback : (JSON.parse(String(v)) as T));
const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

/** Turns one D1 `products` row (JSON columns as text) back into a CatalogProduct. */
function toProduct(r: Row): CatalogProduct {
  return {
    id: String(r.id),
    category: String(r.category),
    subtype: r.subtype as string | null,
    tagSource: r.tag_source as 'reviewed' | 'model',
    names: json(r.names, []),
    salesUnit: r.sales_unit as string | null,
    baseUnit: r.base_unit as string | null,
    unitsPerSales: num(r.units_per_sales),
    lotStep: num(r.lot_step),
    tempClass: num(r.temp_class),
    claims: json(r.claims, []),
    allergens: json(r.allergens, { contains: [], mayContain: [], freeFrom: [] }),
    labels: json(r.labels, []),
    brand: r.brand as string | null,
    brandNorm: String(r.brand_norm ?? ''),
    salesUnitGtin: r.sales_unit_gtin as string | null,
    gtin: r.gtin as string | null,
    units: json(r.units, []),
    origin: r.origin as string | null,
    reliability: num(r.reliability),
    carbon: num(r.carbon),
    substitutes: json(r.substitutes, []),
    variableWeight: r.variable_weight === 1,
    nameContent: json(r.name_content, null),
    searchText: String(r.search_text ?? ''),
  };
}

/**
 * Finds products of one category carrying ALL the requested claims, optionally narrowed by subtype,
 * temperature classes and an `only` brand rule (a `prefer` rule never filters; the quote builder ranks on it).
 * Results are ordered by id so callers get a stable list.
 */
export async function searchProducts(env: Env, f: SearchFilter): Promise<CatalogProduct[]> {
  const where = ['category = ?'];
  const args: (string | number)[] = [f.category];
  for (const c of f.claims) {
    where.push('EXISTS (SELECT 1 FROM json_each(products.claims) WHERE value = ?)');
    args.push(c);
  }
  if (f.subtype) {
    where.push('subtype = ?');
    args.push(f.subtype);
  }
  if (f.tempClasses?.length) {
    where.push(`temp_class IN (${f.tempClasses.map(() => '?').join(',')})`);
    args.push(...f.tempClasses.map(String));
  }
  if (f.brand?.rule === 'only') {
    const norms = f.brand.names.map(normBrand);
    where.push(`brand_norm IN (${norms.map(() => '?').join(',')})`);
    args.push(...norms);
  }
  const { results } = await env.DB.prepare(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY id`).bind(...args).all<Row>();
  return results.map(toProduct);
}

/** Loads products by id (missing ids are simply absent from the result). */
export async function getProducts(env: Env, ids: string[]): Promise<CatalogProduct[]> {
  if (ids.length === 0) return [];
  const { results } = await env.DB.prepare(`SELECT * FROM products WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
    .bind(...ids)
    .all<Row>();
  return results.map(toProduct);
}

/** All products whose sales-unit GTIN equals `gtin` exactly (a few products share one). */
export async function getByGtin(env: Env, gtin: string): Promise<CatalogProduct[]> {
  const { results } = await env.DB.prepare('SELECT * FROM products WHERE sales_unit_gtin = ? ORDER BY id').bind(gtin).all<Row>();
  return results.map(toProduct);
}
