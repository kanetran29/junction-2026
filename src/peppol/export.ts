import { getProducts } from '../catalog/search';
import { featureOn } from '../clock';
import { db } from '../db';
import type { Env } from '../env';
import { getOrder, OrderError } from '../orders/store';
import { sha256Hex } from '../util';
import { buildPeppolOrder } from './order';

/** Whose order to export: a buyer's own order by id, or the order an approval token belongs to. */
export type PeppolBy = { orderId: string; buyerId: string } | { token: string };

/** The columns of an order the export reads besides its view. */
type Stored = { id: string; buyer_id: string; decided_at: string | null };

/** The attachment name of an order's export; the id is cut to safe filename characters. */
export const peppolFilename = (orderId: string): string => `lazydoor-order-${orderId.replace(/[^A-Za-z0-9_.-]/g, '_')}.xml`;

/**
 * The buyer of the sandbox kitchen a visitor token opens, or a 404 for an unknown one. Unlike Try it's own lookup it does not
 * touch `last_used`, so reading an export never keeps a sandbox alive.
 */
export async function visitorBuyer(env: Env, visitor: string): Promise<string> {
  const row = await db(env).prepare('SELECT buyer_id FROM try_visitors WHERE token_hash = ?').bind(await sha256Hex(visitor)).first<{ buyer_id: string }>();
  if (!row) throw new OrderError(404, 'VISITOR_UNKNOWN', 'no such visitor: sandboxes end at a demo reset, after 20 idle minutes or when recycled');
  return row.buyer_id;
}

/**
 * The Peppol BIS Order 3.0 XML of an ACCEPTED order. The `peppol` feature off is 404 NOT_FOUND, an order that does not exist
 * (or is another buyer's, or has an unknown token) is 404 ORDER_NOT_FOUND, and one in any other state is 409 ORDER_NOT_ACCEPTED.
 */
export async function peppolXml(env: Env, by: PeppolBy): Promise<{ orderId: string; xml: string }> {
  if (!(await featureOn(env, 'peppol'))) throw new OrderError(404, 'NOT_FOUND', 'no such route');
  const s = db(env);
  const row =
    'token' in by
      ? await s.prepare("SELECT id, buyer_id, decided_at FROM orders WHERE approval_token = ? AND state <> 'PLACING'").bind(by.token).first<Stored>()
      : await s.prepare("SELECT id, buyer_id, decided_at FROM orders WHERE id = ? AND buyer_id = ? AND state <> 'PLACING'").bind(by.orderId, by.buyerId).first<Stored>();
  const view = row && (await getOrder(env, row.buyer_id, row.id));
  if (!row || !view) throw new OrderError(404, 'ORDER_NOT_FOUND', 'no such order');
  if (view.state !== 'ACCEPTED' || !row.decided_at) throw new OrderError(409, 'ORDER_NOT_ACCEPTED', `the order is ${view.state}; only an ACCEPTED order can be exported`);
  const products = await getProducts(env, view.order.lines.map((l) => l.productId));
  return { orderId: row.id, xml: buildPeppolOrder(view.order, { buyerId: row.buyer_id, decidedAt: row.decided_at, products }) };
}
