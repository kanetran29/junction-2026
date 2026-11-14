import { describe, expect, it, vi } from 'vitest';
import { runBuyer } from '../agent/buyer';

/** A gateway whose `search_products` answers the given replies in turn, plus a Gemini that calls it once and then answers. */
function stubs(replies: unknown[]) {
  let gemini = 0;
  let search = 0;
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    if (String(url).includes('generativelanguage')) {
      const part = gemini++ === 0 ? { functionCall: { name: 'search_products', args: { category: '10400', claims: [] } } } : { text: 'done' };
      return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [part] } }] }));
    }
    const { id, method } = JSON.parse(init.body as string);
    if (method === 'tools/list') return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { tools: [{ name: 'search_products', description: 'x', inputSchema: { type: 'object' } }] } }));
    if (method === 'tools/call') {
      const r = replies[search++] as { structured?: unknown; refusal?: unknown };
      const result = r.refusal ? { isError: true, content: [{ type: 'text', text: JSON.stringify(r.refusal) }] } : { structuredContent: r.structured, content: [] };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }));
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: {} }));
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, searches: () => search };
}
const run = (s: ReturnType<typeof stubs>, sleep: (ms: number) => Promise<void>) =>
  runBuyer({ gatewayUrl: 'http://door', apiKey: 'k', request: 'milk', buyerProfile: { autoCents: 50000 }, fetchFn: s.fetchFn, geminiKey: 'g', log: () => undefined, sleep });
const limited = (retryAfter: number) => ({ refusal: { error: 'VALIO_RATE_LIMITED', detail: 'slow down', retryAfter } });

describe('buyer agent and Valio rate limits', () => {
  it('waits retryAfter seconds and retries the same tool call once', async () => {
    const sleep = vi.fn(async () => undefined);
    const s = stubs([limited(25), { structured: { products: [{ id: 'P1' }], valioCalls: 0 } }]);
    const trace = await run(s, sleep);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(25000);
    expect(s.searches()).toBe(2);
    expect(trace.steps[0].result).toMatchObject({ products: [{ id: 'P1' }] });
  });

  it('reports it when retryAfter is above 60 s, and gives up after one retry', async () => {
    const sleep = vi.fn(async () => undefined);
    const long = stubs([limited(90)]);
    expect((await run(long, sleep)).steps[0].result).toMatchObject({ error: 'VALIO_RATE_LIMITED' });
    expect(sleep).not.toHaveBeenCalled();
    const twice = stubs([limited(5), limited(5)]);
    expect((await run(twice, sleep)).steps[0].result).toMatchObject({ error: 'VALIO_RATE_LIMITED' });
    expect(sleep).toHaveBeenCalledOnce();
    expect(twice.searches()).toBe(2);
  });
});
