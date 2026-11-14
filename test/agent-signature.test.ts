import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { runBuyer } from '../agent/buyer';
import type { Env } from '../src/env';
import { AUD, jwks, signJws } from '../src/sign/door';

const e = env as unknown as Env;

/** A gateway with one quote whose offer carries `jws`, and a Gemini that quotes, places offer o1, then answers. */
async function stubs(jws: (good: string) => string) {
  const line = { productId: 'P1', salesUnits: 10, netCentsPerSalesUnit: 100 };
  const good = await signJws(e, { quoteId: 'q1', offerId: 'o1', buyerId: 'hotel-a', deliveryDate: '2026-11-16', lines: [{ productId: 'P1', salesUnits: 10, unitPriceCents: 100, netCents: 1000 }], netCents: 1000, grossCents: 1135, currency: 'EUR', validUntil: '2026-11-13T21:40:00+02:00', iat: 1, aud: AUD.quote });
  const offer = { offerId: 'o1', lines: [line], filled: 10, shortfall: 0, netCents: 1000, grossCents: 1135, deliveryDate: '2026-11-16', changes: [], jws: jws(good) };
  const placed: unknown[] = [];
  let turn = 0;
  const fetchFn = (async (url: string, init: RequestInit) => {
    if (String(url).endsWith('/.well-known/jwks.json')) return new Response(JSON.stringify(await jwks(e)));
    if (String(url).includes('generativelanguage')) {
      const calls = [
        { functionCall: { name: 'get_quote', args: { draftId: 'd1' } } },
        { functionCall: { name: 'place_order', args: { quoteId: 'q1', offerId: 'o1', agentReason: 'cheapest' } } },
        { text: 'done' },
      ];
      return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [calls[Math.min(turn++, 2)]] } }] }));
    }
    const { id, method, params } = JSON.parse(init.body as string);
    if (method === 'tools/list') return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { tools: [{ name: 'get_quote', description: 'x', inputSchema: { type: 'object' } }, { name: 'place_order', description: 'x', inputSchema: { type: 'object' } }] } }));
    if (method === 'tools/call' && params.name === 'get_quote') return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { structuredContent: { id: 'q1', expiresAt: '2026-11-13T21:40:00+02:00', offers: [offer], rejections: [] }, content: [] } }));
    if (method === 'tools/call' && params.name === 'place_order') {
      placed.push(params.arguments);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { structuredContent: { orderId: 'ord1', state: 'ACCEPTED', decision: { outcome: 'AUTO', reasons: [] }, approval: { status: 'none', approver: '' }, order: { netCents: 1000 } }, content: [] } }));
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: {} }));
  }) as unknown as typeof fetch;
  return { fetchFn, placed };
}

/** Runs the agent against the stubs and returns its log lines and what it placed. */
async function run(jws: (good: string) => string) {
  const s = await stubs(jws);
  const lines: string[] = [];
  await runBuyer({ gatewayUrl: 'http://door', apiKey: 'k', request: 'milk', buyerProfile: { autoCents: 50000 }, fetchFn: s.fetchFn, geminiKey: 'g', log: (l) => lines.push(l) });
  return { lines, placed: s.placed };
}

describe('reference agent and signed quotes', () => {
  it('verifies the offer JWS against the JWKS before ordering and sends it back', async () => {
    const { lines, placed } = await run((good) => good);
    expect(lines.some((l) => l.includes('quote signature verified'))).toBe(true);
    expect(placed).toEqual([expect.objectContaining({ quoteId: 'q1', offerId: 'o1', quoteJws: expect.any(String) })]);
  });

  it('refuses a validly signed offer whose lines or totals differ from what the quote showed', async () => {
    const other = await signJws(e, { quoteId: 'q1', offerId: 'o1', buyerId: 'hotel-a', deliveryDate: '2026-11-16', lines: [{ productId: 'P1', salesUnits: 20, unitPriceCents: 50, netCents: 1000 }], netCents: 1000, grossCents: 1135, currency: 'EUR', validUntil: '2026-11-13T21:40:00+02:00', iat: 1, aud: AUD.quote });
    const { placed } = await run(() => other);
    expect(placed).toEqual([]);
  });

  it('does not place an order whose quote signature does not verify, or that has none', async () => {
    for (const jws of [(good: string) => `${good.slice(0, -4)}AAAA`, () => '']) {
      const { lines, placed } = await run(jws);
      expect(placed).toEqual([]);
      expect(lines.some((l) => l.includes('QUOTE_SIGNATURE_INVALID'))).toBe(true);
    }
  });
});
