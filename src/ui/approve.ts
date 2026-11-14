import { Hono } from 'hono';
import qrcode from 'qrcode-generator';
import { getProducts } from '../catalog/search';
import { now } from '../clock';
import { REASONS } from '../domain/reasons';
import type { Env } from '../env';
import { identify } from '../http/auth';
import { OrderError, approve, approverInbox, freeStock, getOrder, limitKey, reject, type ApproveReply, type OrderView } from '../orders/store';
import type { Draft, OfferLine } from '../quote/build';
import { getQuote } from '../quote/store';
import { STOCK_UNKNOWN_NOTE } from '../offers/orderable';
import { ValioRateLimited } from '../valio/client';
import { lineNet } from '../domain/money';
import { eur, productName, qty, renderReceipt } from '../receipt/render';
import { db } from '../db';

/** Escapes a value for HTML text and double-quoted attributes; every interpolated value goes through it. */
export function escapeHtml(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const CSS = `*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;background:#f6f5f1;color:#1d1d1b}
main{max-width:480px;margin:0 auto;padding:16px}h1{font-size:1.3rem;margin:.2rem 0 1rem}h2{font-size:1rem;margin:1.2rem 0 .4rem}
.card{background:#fff;border-radius:12px;padding:12px 14px;margin:8px 0;box-shadow:0 1px 3px #0001}.muted{color:#666;font-size:.9rem}
pre{white-space:pre-wrap;word-break:break-word;font-size:.8rem;margin:0}.total{font-weight:600;font-size:1.05rem}
form{display:inline}button{font:inherit;font-size:1.05rem;border:0;border-radius:10px;padding:14px 22px;margin:6px 6px 0 0;color:#fff;background:#1d6b3a}
button.no{background:#a33}.state{font-weight:600}.qr svg{width:160px;height:160px}a{color:#1d6b3a}`;

/** Wraps a body in the phone-first page shell: viewport, Google Fonts (the only external asset) and the shared style. */
function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap">
<style>${CSS}</style></head><body><main>${body}</main></body></html>`;
}

/** The stored order columns the pages need beyond the order view. */
interface Meta {
  buyer_id: string;
  quote_id: string | null;
  basket_id: string | null;
  agent_reason: string | null;
  expires_at: string | null;
}

/** The needs an order answers: its quote's draft, or every quote of its basket. */
async function draftsOf(env: Env, m: Meta): Promise<Draft[]> {
  const ids = m.quote_id ? [m.quote_id] : [];
  if (m.basket_id) {
    const b = await db(env).prepare('SELECT body FROM baskets WHERE id = ? AND buyer_id = ?').bind(m.basket_id, m.buyer_id).first<{ body: string }>();
    if (b) ids.push(...(JSON.parse(b.body) as { quoteIds: string[] }).quoteIds);
  }
  const quotes = await Promise.all(ids.map((id) => getQuote(env, m.buyer_id, id)));
  return quotes.flatMap((q) => (q ? [q.understoodAs] : []));
}

/** The free stock of each product and day now, from the shared `freeStock` rule; empty when Valio does not answer (the page then says unknown). */
async function pageStock(env: Env, lines: OfferLine[], buyerId: string, fetchFn: typeof fetch): Promise<Map<string, number | null>> {
  try {
    return await freeStock(env, lines, await now(env), buyerId, fetchFn);
  } catch (err) {
    if ((err instanceof OrderError && err.status === 502) || err instanceof ValioRateLimited) return new Map();
    throw err;
  }
}

/** A not-found page. */
const notFound = (what: string) => ({ status: 404 as const, html: page('Lazydoor – not found', `<h1>Not found</h1><p>${escapeHtml(what)}</p>`) });

/**
 * The phone approval page of one order by its token: the lines with live free stock ("not reserved"), the need as understood,
 * what differs from it with the reasons' human text, the agent's reason, net and gross, the cut-off (seconds left by the door's clock in a
 * data attribute, so the countdown ignores the phone clock) and the Approve / Reject forms. Past the cut-off, or once resolved, it shows "expired" or the
 * final state and no forms. An unknown token is 404.
 */
export async function renderApprovePage(env: Env, token: string, fetchFn: typeof fetch = fetch): Promise<{ status: 200 | 404; html: string }> {
  const m = await db(env).prepare('SELECT id, buyer_id, quote_id, basket_id, agent_reason, expires_at FROM orders WHERE approval_token = ?').bind(token).first<Meta & { id: string }>();
  const view = m && (await getOrder(env, m.buyer_id, m.id));
  if (!m || !view) return notFound('No order for this approval link.');
  const { order, decision } = view;
  const drafts = await draftsOf(env, m);
  const nowMs = (await now(env)).getTime();
  const live = order.state === 'HELD' && nowMs < Date.parse(m.expires_at!);
  const stock = live ? await pageStock(env, order.lines, m.buyer_id, fetchFn) : new Map<string, number | null>();
  const products = await getProducts(env, order.lines.map((l) => l.productId));

  const lineHtml = order.lines.map((l) => {
    const free = stock.get(limitKey(l));
    const note = !live ? '' : free === undefined ? 'availability unknown right now' : free === null ? STOCK_UNKNOWN_NOTE : `not reserved: ${qty(free)} available now`;
    const nm = productName(products, l.productId);
    return `<div class="card"><b>${escapeHtml(l.productId)}</b> ${escapeHtml(nm)}<br>${qty(l.salesUnits)} × ${qty(l.contentPerSalesUnit)} ${escapeHtml(l.contentUnit)} · ${eur(lineNet(l))} EUR<br><span class="muted">${escapeHtml(note)}</span></div>`;
  }).join('');
  const delivered = order.lines.reduce((s, l) => s + l.salesUnits * l.contentPerSalesUnit, 0);
  const diff = drafts.length === 1 ? `<div class="card">Requested ${qty(drafts[0].quantity.value)} ${escapeHtml(drafts[0].quantity.unit)}, delivered ${qty(Math.round(delivered * 1000) / 1000)} ${escapeHtml(order.lines[0]?.contentUnit ?? '')}</div>` : '';
  const reasons = decision.reasons.map((r) => `<div class="card"><b>${escapeHtml(r.code)}</b> ${escapeHtml(REASONS[r.code].text)}${r.detail ? `<br><span class="muted">${escapeHtml(r.detail)}</span>` : ''}</div>`).join('');
  const understood = drafts.map((d) => `<div class="card"><pre>${escapeHtml(JSON.stringify(d, null, 2))}</pre></div>`).join('');

  let action: string;
  if (live) {
    action = `<p class="muted">Decide within <b id="left" data-left="${Math.max(0, Math.floor((Date.parse(m.expires_at!) - nowMs) / 1000))}"></b></p>
<form method="post" action="/approve/${escapeHtml(token)}"><button>Approve</button></form><form method="post" action="/reject/${escapeHtml(token)}"><button class="no">Reject</button></form>
<script>var el=document.getElementById('left'),t=Date.now()+el.dataset.left*1000;function tick(){var s=Math.max(0,Math.floor((t-Date.now())/1000));el.textContent=Math.floor(s/3600)+'h '+Math.floor(s%3600/60)+'m '+s%60+'s'}tick();setInterval(tick,1000)</script>`;
  } else {
    const label = order.state === 'HELD' || order.state === 'EXPIRED' ? 'expired' : order.state;
    action = `<p class="state">This approval is ${escapeHtml(label)}${view.reason ? ` (${escapeHtml(view.reason)})` : ''}.</p>`;
  }
  const body = `<h1>Approve order</h1><p class="muted">Order ${escapeHtml(order.id)} · delivery ${escapeHtml(order.deliveryDate ?? '')}</p>
<h2>Lines</h2>${lineHtml}<h2>What changed</h2>${diff}${reasons}<h2>Agent's reason</h2><div class="card">${escapeHtml(m.agent_reason ?? 'none given')}</div>
<h2>Need, as understood</h2>${understood}<p class="total">Net ${eur(order.netCents)} EUR<br>Gross ${eur(order.grossCents)} EUR</p>${action}`;
  return { status: 200, html: page('Lazydoor – approve order', body) };
}

/** The approver inbox as HTML: one card per pending approval with its link and a QR code (inline SVG) of the link. */
function renderInboxHtml(inbox: Awaited<ReturnType<typeof approverInbox>>, origin: string): string {
  const cards = inbox.pending.map((p) => {
    const url = `${origin}/approve/${p.token}`;
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    return `<div class="card"><b>${escapeHtml(p.orderId)}</b><br>Net ${eur(p.netCents)} EUR · Gross ${eur(p.grossCents)} EUR<br><span class="muted">decide by ${escapeHtml(p.approvalExpiresAt)}</span>
<div class="qr">${qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })}</div><a href="${escapeHtml(url)}">Open approval</a></div>`;
  });
  const body = `<h1>Approver inbox</h1><p class="muted">${escapeHtml(inbox.approver)} · ${escapeHtml(inbox.buyerId)}</p>${cards.join('') || '<p>Nothing is waiting for approval.</p>'}`;
  return page('Lazydoor – approver inbox', body);
}

/** The result page shown after the Approve or Reject form is posted. */
function resultPage(r: ApproveReply): string {
  const text = r.state === 'ACCEPTED' ? 'The order is accepted: binding, invoiced on delivery (simulated).' : r.state === 'REJECTED' ? 'The order was rejected.' : 'The order expired and nothing was placed.';
  const why = r.reason && r.reason in REASONS ? `<p>${escapeHtml(REASONS[r.reason as keyof typeof REASONS].text)}</p>` : '';
  const avail = r.available !== undefined ? `<p>${qty(r.available)} available now.</p>` : '';
  return page('Lazydoor – approval result', `<h1>${escapeHtml(r.state)}</h1><p>${text}</p>${why}${avail}`);
}

/**
 * The plain-text receipt of a settled order, or null when it does not exist, is still being placed or (when `buyerId` is
 * given) belongs to another buyer. Without `buyerId` the order id itself is the capability (the public receipt page).
 */
export async function receiptText(env: Env, orderId: string, buyerId?: string): Promise<string | null> {
  const m = await db(env).prepare("SELECT buyer_id, quote_id, basket_id, agent_reason, expires_at FROM orders WHERE id = ?1 AND state <> 'PLACING' AND (?2::text IS NULL OR buyer_id = ?2)").bind(orderId, buyerId ?? null).first<Meta>();
  const view: OrderView | null = m && (await getOrder(env, m.buyer_id, orderId));
  if (!m || !view) return null;
  const products = await getProducts(env, view.order.lines.map((l) => l.productId));
  return renderReceipt(view.order, await draftsOf(env, m), view.decision, { products, approver: view.approval.approver, reason: view.reason });
}

/**
 * The approval, receipt and inbox routes. `fetchFn` reaches Valio for the live stock on the page and for the approve
 * re-check. The approval link and the inbox are the approver's; nothing here ever reaches the agent.
 */
export function uiRoutes(fetchFn: typeof fetch = fetch): Hono<{ Bindings: Env }> {
  const ui = new Hono<{ Bindings: Env }>();
  const wantsJson = (accept: string | undefined) => Boolean(accept?.includes('application/json'));

  ui.onError((err, c) => {
    if (!(err instanceof OrderError) && !(err instanceof ValioRateLimited)) throw err;
    const limited = err instanceof ValioRateLimited;
    const code = limited ? 'VALIO_RATE_LIMITED' : err.code;
    const status = limited ? 503 : (err.status as 400 | 401 | 403 | 404 | 409 | 422 | 502);
    if (limited) c.header('Retry-After', String(err.retryAfter));
    if (!c.req.header('Accept')?.includes('text/html')) return c.json({ error: code, detail: err.message, ...(limited ? { retryAfter: err.retryAfter } : {}) }, status);
    return c.html(page('Lazydoor – approval result', `<h1>${escapeHtml(code)}</h1><p>${escapeHtml(err.message)}</p>`), status);
  });

  ui.get('/approve/:token', async (c) => {
    const r = await renderApprovePage(c.env, c.req.param('token'), fetchFn);
    return c.html(r.html, r.status);
  });

  for (const [verb, act] of [['approve', (e: Env, t: string, role: 'approver' | 'agent') => approve(e, t, { callerRole: role }, fetchFn)], ['reject', (e: Env, t: string, role: 'approver' | 'agent') => reject(e, t, { callerRole: role })]] as const) {
    ui.post(`/${verb}/:token`, async (c) => {
      const who = await identify(c.env, c.req.header('Authorization'));
      const r = await act(c.env, c.req.param('token'), who?.role === 'agent' || who?.role === 'judge' ? 'agent' : 'approver');
      return wantsJson(c.req.header('Accept')) || !c.req.header('Accept')?.includes('text/html') ? c.json(r) : c.html(resultPage(r));
    });
  }

  ui.get('/approver/:key', async (c) => {
    let inbox;
    try {
      inbox = await approverInbox(c.env, c.req.param('key'));
    } catch (err) {
      if (err instanceof OrderError && err.status === 401) {
        return wantsJson(c.req.header('Accept')) ? c.json({ error: 'APPROVER_KEY_UNKNOWN', detail: 'unknown approver key' }, 404) : c.html(notFound('Unknown approver key.').html, 404);
      }
      throw err;
    }
    const origin = new URL(c.req.url).origin;
    if (wantsJson(c.req.header('Accept'))) return c.json({ ...inbox, pending: inbox.pending.map((p) => ({ ...p, url: `${origin}/approve/${p.token}` })) });
    return c.html(renderInboxHtml(inbox, origin));
  });

  ui.get('/receipt/:orderId', async (c) => {
    const text = await receiptText(c.env, c.req.param('orderId'));
    return text === null ? c.json({ error: 'ORDER_NOT_FOUND', detail: 'no such order' }, 404) : c.text(text);
  });

  return ui;
}
