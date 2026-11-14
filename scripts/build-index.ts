import { normBrand, type CatalogProduct, type NameContent } from '../src/catalog/search';
import { tagSubtype } from '../src/catalog/subtypes';

interface RawGroup {
  name: string;
  values: { id: string; unit?: string }[];
}
interface RawProduct {
  id: string;
  salesUnitGtin?: string | null;
  salesUnit?: string | null;
  baseUnit?: string | null;
  category: string;
  allowedLotSize?: number;
  temperatureCondition?: number | null;
  countryOfOrigin?: string | null;
  units?: { unitId: string; gtin?: string; sizeInBaseUnits: number }[];
  substitutions?: { product: string; substituteProduct: string }[];
  synkkaData: {
    gtin?: string | null;
    brand?: string | null;
    variableUnit?: boolean;
    names?: { language: string; value: string }[];
    marketingTexts?: { value?: string }[];
    usageInstructions?: { value?: string }[];
    classifications?: RawGroup[];
  };
}

const UNIT_FACTORS: Record<string, [number, 'l' | 'kg']> = { l: [1, 'l'], dl: [0.1, 'l'], cl: [0.01, 'l'], ml: [0.001, 'l'], kg: [1, 'kg'], g: [0.001, 'kg'] };
/** Rounds to 6 decimals (tames float noise in name-derived totals). */
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Parses the first content statement in a product name ("1 l", "2,5 dl", "100x2 cl", "10 kg") into size, count and a litre/kilo total. */
export function parseNameContent(name: string): NameContent | null {
  const m = /(?:(\d+)\s*x\s*)?(\d+(?:[.,]\d+)?)\s*(kg|dl|cl|ml|l|g)(?![\p{L}\p{N}])/iu.exec(name);
  if (!m) return null;
  const count = m[1] ? Number(m[1]) : 1;
  const size = Number(m[2].replace(',', '.'));
  const unit = m[3].toLowerCase();
  const [factor, totalUnit] = UNIT_FACTORS[unit];
  return { count, size, unit, total: round6(count * size * factor), totalUnit };
}

/** Parses a two-column `id,value` CSV (header skipped) into a map of id to number. */
function csvMap(csv: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const [id, value] = line.split(',');
    if (id && value !== undefined && value.trim() !== '' && !Number.isNaN(Number(value))) out.set(id.trim(), Number(value));
  }
  return out;
}

/** The ids of a raw product's classification group `name` (optionally only values with `unit`), as stored in the index. */
const groupIds = (p: RawProduct, name: string, unit?: string): string[] =>
  (p.synkkaData.classifications ?? []).filter((g) => g.name === name).flatMap((g) => g.values.filter((v) => !unit || v.unit === unit).map((v) => v.id));

/**
 * The search text the oracle uses for occasion matching: marketing and usage texts lowercased, with the product's
 * own names and brand blanked out so a name like "Juhla Mokka" is not evidence of a party. Matching is plain substring.
 */
function searchText(p: RawProduct): string {
  const s = p.synkkaData;
  let blob = [...(s.marketingTexts ?? []), ...(s.usageInstructions ?? [])].map((x) => x.value ?? '').join(' ').toLowerCase();
  const own = [...(s.names ?? []).map((n) => (n.value ?? '').toLowerCase()), (s.brand ?? '').toLowerCase().trim()];
  for (const o of own) if (o) blob = blob.split(o).join(' ');
  return blob;
}

/**
 * Pure transform of Valio's raw products plus the reliability and carbon CSVs into catalogue rows: claims, allergens,
 * labels, sales-unit size, lot step, brand (normalised plus the most frequent spelling per norm as display),
 * oracle-identical search text, and reviewed subtypes for the three demo families.
 */
export function buildRows(products: RawProduct[], reliabilityCsv: string, carbonCsv: string): CatalogProduct[] {
  const reliability = csvMap(reliabilityCsv);
  const carbon = csvMap(carbonCsv);

  const spellings = new Map<string, Map<string, number>>();
  for (const p of products) {
    const trimmed = (p.synkkaData.brand ?? '').trim();
    const norm = normBrand(trimmed);
    if (!norm) continue;
    const counts = spellings.get(norm) ?? new Map<string, number>();
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
    spellings.set(norm, counts);
  }
  const display = new Map<string, string>();
  for (const [norm, counts] of spellings) {
    display.set(norm, [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0]);
  }

  return products.map((p) => {
    const names = p.synkkaData.names ?? [];
    const fi = (names.find((n) => n.language.startsWith('fi')) ?? names[0])?.value ?? '';
    const brandNorm = normBrand(p.synkkaData.brand);
    const tag = tagSubtype(p.category, fi);
    return {
      id: p.id,
      category: p.category,
      ...tag,
      names,
      salesUnit: p.salesUnit ?? null,
      baseUnit: p.baseUnit ?? null,
      unitsPerSales: (p.units ?? []).find((u) => u.unitId === p.salesUnit)?.sizeInBaseUnits ?? null,
      lotStep: p.allowedLotSize === undefined || p.allowedLotSize === 0.01 ? null : p.allowedLotSize,
      tempClass: p.temperatureCondition ?? null,
      claims: groupIds(p, 'nutritionalClaim'),
      allergens: { contains: groupIds(p, 'allergen', 'CONTAINS'), mayContain: groupIds(p, 'allergen', 'MAY_CONTAIN'), freeFrom: groupIds(p, 'nonAllergen') },
      labels: groupIds(p, 'packagingMarkedLabel'),
      brand: display.get(brandNorm) ?? null,
      brandNorm,
      salesUnitGtin: p.salesUnitGtin ?? null,
      gtin: p.synkkaData.gtin ?? null,
      units: p.units ?? [],
      origin: p.countryOfOrigin ?? null,
      reliability: reliability.get(p.id) ?? null,
      carbon: carbon.get(p.id) ?? null,
      substitutes: (p.substitutions ?? []).map((s) => s.substituteProduct),
      variableWeight: Boolean(p.synkkaData.variableUnit),
      nameContent: parseNameContent(fi),
      searchText: searchText(p),
    };
  });
}

/** One SQL literal: NULL, a number, a boolean as 0/1, or a quoted string (objects as JSON text). */
const lit = (v: string | number | boolean | null | object): string => {
  if (v === null) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${(typeof v === 'string' ? v : JSON.stringify(v)).replaceAll("'", "''")}'`;
};

/**
 * Renders rows as INSERT statements, packed into multi-row statements of at most `maxChars` so each stays under D1's
 * statement size limit: one for `products` (INSERT OR REPLACE) and one set for the per-packaging-level `product_gtins`.
 */
export function insertStatements(rows: CatalogProduct[], maxChars = 60_000): string[] {
  /** Splits `tuples` into INSERT statements under `head`, each at most `maxChars` long. */
  const pack = (head: string, tuples: string[]): string[] => {
    const out: string[] = [];
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
  };
  const productHead =
    'INSERT OR REPLACE INTO products (id,category,subtype,tag_source,names,sales_unit,base_unit,units_per_sales,lot_step,temp_class,claims,allergens,labels,brand,brand_norm,sales_unit_gtin,gtin,units,origin,reliability,carbon,substitutes,variable_weight,name_content,search_text) VALUES ';
  const products = rows.map(
    (r) =>
      `(${[r.id, r.category, r.subtype, r.tagSource, r.names, r.salesUnit, r.baseUnit, r.unitsPerSales, r.lotStep, r.tempClass === null ? null : String(r.tempClass), r.claims, r.allergens, r.labels, r.brand, r.brandNorm, r.salesUnitGtin, r.gtin, r.units, r.origin, r.reliability, r.carbon === null ? null : String(r.carbon), r.substitutes, r.variableWeight, r.nameContent, r.searchText].map(lit).join(',')})`,
  );
  const gtins = rows.flatMap((r) => r.units.filter((u) => u.gtin).map((u) => `(${lit(u.gtin!)},${lit(r.id)},${lit(u.unitId)})`));
  return [...pack(productHead, products), ...pack('INSERT INTO product_gtins (gtin,product_id,unit_id) VALUES ', gtins)];
}

/** Reads the raw Valio files, builds the rows and writes `.data/valio/build/products.sql` (kept out of the repo). */
async function main(): Promise<void> {
  const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
  const dir = '.data/valio';
  const products = JSON.parse(readFileSync(`${dir}/data/product_data.json`, 'utf8')) as RawProduct[];
  const rows = buildRows(products, readFileSync(`${dir}/data/delivery_reliability.csv`, 'utf8'), readFileSync(`${dir}/data/carbon_footprint.csv`, 'utf8'));
  const statements = ['DELETE FROM product_gtins', ...insertStatements(rows)];
  mkdirSync(`${dir}/build`, { recursive: true });
  writeFileSync(`${dir}/build/products.sql`, statements.map((s) => `${s};\n`).join(''));
  console.log(`${rows.length} products, ${statements.length} statements -> ${dir}/build/products.sql`);
}

const entry = (globalThis as { process?: { argv?: string[] } }).process?.argv?.[1];
if (entry && entry.endsWith('build-index.ts')) await main();
