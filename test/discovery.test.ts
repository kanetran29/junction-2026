import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { createApp } from '../src/http/routes';
import { mcpRoutes } from '../src/mcp/tools';

const e = { ...(env as unknown as Env), DEMO_MODE: '1', ADMIN_KEY: 'adm', DEMO_OPENS_AT: '2000-01-01T00:00:00Z' };
const app = createApp(async () => {
  throw new Error('discovery makes no outside call');
});
app.route('/', mcpRoutes());
const ORIGIN = 'https://door.example';
const get = (path: string) => app.request(`${ORIGIN}${path}`, {}, e);

/** Every string in a JSON value that is a URL on the door's own origin. */
const ownUrls = (v: unknown): string[] =>
  typeof v === 'string' ? (v.startsWith(ORIGIN) ? [v] : []) : v && typeof v === 'object' ? Object.values(v).flatMap(ownUrls) : [];

describe('/.well-known/agent-gateway.json', () => {
  it('describes the door for any agent: API, MCP, rules, events, audit, keys, approval model, demo and code', async () => {
    const r = await get('/.well-known/agent-gateway.json');
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toContain('application/json');
    expect(await r.json()).toMatchObject({
      name: 'Lazydoor',
      punchline: 'Lazy at the order, strict at the border.',
      version: expect.any(String),
      openapi: `${ORIGIN}/openapi.json`,
      mcp: { url: `${ORIGIN}/mcp`, transport: 'streamable-http', auth: expect.stringContaining('Bearer') },
      rules: `${ORIGIN}/v1/rules`,
      reasonCodes: `${ORIGIN}/v1/reason-codes`,
      events: { poll: `${ORIGIN}/v1/events`, stream: `${ORIGIN}/v1/events/stream` },
      audit: { verify: `${ORIGIN}/v1/audit/verify` },
      jwks: `${ORIGIN}/.well-known/jwks.json`,
      approval: { agentCanApprove: false, rule: expect.stringContaining('403') },
      demo: `${ORIGIN}/demo/`,
      repository: 'https://github.com/kanetran29/junction-2026',
    });
  });

  it('points only at routes that answer on this door', async () => {
    const urls = ownUrls(await (await get('/.well-known/agent-gateway.json')).json());
    expect(urls.length).toBeGreaterThanOrEqual(9);
    for (const url of urls) {
      const post = /\/v1\/try(\/decision)?$/.test(url);
      const r = await app.request(url, post ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}, e);
      expect([url, r.status === 404]).toEqual([url, false]);
      await r.body?.cancel();
    }
  });

  it('is linked from /openapi.json', async () => {
    const doc = (await (await get('/openapi.json')).json()) as { info: { description: string }; externalDocs?: { url: string } };
    expect(doc.info.description).toContain('/.well-known/agent-gateway.json');
    expect(doc.externalDocs?.url).toBe(`${ORIGIN}/.well-known/agent-gateway.json`);
  });
});
