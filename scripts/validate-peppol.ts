import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CatalogProduct } from '../src/catalog/search';
import { grossCents, lineNet } from '../src/domain/money';
import type { Order } from '../src/orders/store';
import { buildPeppolOrder } from '../src/peppol/order';
import type { OfferLine } from '../src/quote/build';

/**
 * Builds Peppol Order XML for a few fixture orders with the pure builder and validates each with `xmllint` against the
 * vendored OASIS UBL 2.1 Order schema. Exits non-zero when any document fails, so it can gate a release.
 *
 * Run: pnpm exec tsx scripts/validate-peppol.ts
 */
const SCHEMA = new URL('../vendor/ubl-2.1/maindoc/UBL-Order-2.1.xsd', import.meta.url).pathname;

const line = (productId: string, o: Partial<OfferLine> = {}): OfferLine => ({ productId, salesUnits: 4, salesUnit: 'ST', contentPerSalesUnit: 1, contentUnit: 'l', netCentsPerSalesUnit: 123, taxRate: 13.5, deliveryDate: '2026-11-16', ...o });

/** An accepted order over the lines, with net and gross computed as the door does (VAT grossed up per rate). */
function order(id: string, lines: OfferLine[]): Order {
  const byRate = new Map<number, number>();
  for (const l of lines) byRate.set(l.taxRate, (byRate.get(l.taxRate) ?? 0) + lineNet(l));
  const netCents = lines.reduce((s, l) => s + lineNet(l), 0);
  return { id, state: 'ACCEPTED', lines, unmet: [], netCents, grossCents: grossCents(byRate), deliveryDate: '2026-11-16' };
}

/** A catalogue row with just what the export reads: a name and an optional sales-unit GTIN. */
const prod = (id: string, name: string, salesUnitGtin: string | null): CatalogProduct => ({ id, names: [{ language: 'en', value: name }], salesUnitGtin }) as CatalogProduct;

const ctx = (products: CatalogProduct[], buyerId = 'hotel-a') => ({ buyerId, decidedAt: '2026-11-13T21:10:00+02:00', products });

const cases: { name: string; xml: string }[] = [
  { name: 'single line, with GTIN', xml: buildPeppolOrder(order('ord_1', [line('P1')]), ctx([prod('P1', 'Lactose-free milk 1 l', '6410405060457')])) },
  {
    name: 'two lines, two VAT rates, one without GTIN, unit codes',
    xml: buildPeppolOrder(
      order('ord_2', [line('P1', { salesUnits: 12 }), line('P2', { salesUnit: 'KI', taxRate: 25.5, netCentsPerSalesUnit: 899, salesUnits: 2.5 }), line('P3', { salesUnit: 'PAK', taxRate: 25.5 })]),
      ctx([prod('P1', 'Milk', '6410405060457'), prod('P2', 'Cheese', null), prod('P3', 'Butter', null)]),
    ),
  },
  {
    name: 'characters that need escaping',
    xml: buildPeppolOrder(order('ord_<&>"\'3', [line('P<1>')]), ctx([prod('P<1>', 'Milk "Fresh" <b>&</b> o\'clock\u0001', '6410405060457')], 'kitchen & <co>')),
  },
];

const dir = mkdtempSync(join(tmpdir(), 'peppol-'));
let failed = 0;
for (const [i, c] of cases.entries()) {
  const file = join(dir, `case-${i}.xml`);
  writeFileSync(file, c.xml);
  try {
    execFileSync('xmllint', ['--noout', '--schema', SCHEMA, file], { stdio: 'pipe' });
    console.log(`ok   ${c.name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${c.name}\n${(err as { stderr?: Buffer }).stderr?.toString() ?? err}`);
  }
}
rmSync(dir, { recursive: true, force: true });
console.log(failed ? `${failed} of ${cases.length} failed` : `all ${cases.length} valid against UBL-Order-2.1.xsd`);
process.exit(failed ? 1 : 0);
