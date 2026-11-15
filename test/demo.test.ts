import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { createApp } from '../src/http/routes';

/** A door whose demo page is already open (the open time is in the past). */
const e = { ...(env as unknown as Env), DEMO_OPENS_AT: '2000-01-01T00:00:00Z' };
const app = createApp(async () => {
  throw new Error('the demo page makes no Valio call');
});
const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers }, e);

describe('/demo before it opens (hidden from everyone but preview holders, by real time)', () => {
  const TOKEN = 'preview-secret-0123456789';
  const hidden = { ...(env as unknown as Env), DEMO_MODE: '1', ADMIN_KEY: 'adm', DEMO_OPENS_AT: '2999-01-01T00:00:00Z', DEMO_PREVIEW_TOKEN: TOKEN };
  const at = (path: string, headers: Record<string, string> = {}, env: Env = hidden) => app.request(path, { headers }, env);

  it('answers 404 for the page and every file, exactly like an unknown route', async () => {
    const unknown = await (await at('/no-such-route')).json();
    for (const path of ['/demo', '/demo/', '/demo/?mode=deck', '/demo/main.mjs', '/demo/assets/deck/lazydoor-deck.pdf', '/demo/assets/deck/01.webp', '/demo/assets/voice/01.mp3', '/demo/proof.json']) {
      const r = await at(path);
      expect(r.status, path).toBe(404);
      expect(await r.json(), path).toEqual(unknown);
    }
  });

  it('shows the page for the right preview token and sets a cookie for /demo until the open time; the cookie opens every file', async () => {
    const r = await at(`/demo/?preview=${TOKEN}`);
    expect(r.status).toBe(200);
    const cookie = r.headers.get('Set-Cookie')!;
    for (const part of [`lazydoor_preview=${TOKEN}`, 'Path=/demo', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Expires=Tue, 01 Jan 2999 00:00:00 GMT']) expect(cookie).toContain(part);
    const withCookie = { Cookie: `lazydoor_preview=${TOKEN}` };
    expect((await at('/demo/main.mjs', withCookie)).status).toBe(200);
    expect((await at('/demo/assets/deck/01.webp', withCookie)).status).toBe(200);
    const range = await at('/demo/assets/voice/01.mp3', { ...withCookie, Range: 'bytes=0-9' });
    expect(range.status).toBe(206);
    expect((await at('/demo', withCookie)).status).toBe(301);
  });

  it('refuses a wrong token or cookie, and any token when no preview token is configured', async () => {
    expect((await at('/demo/?preview=wrong')).status).toBe(404);
    expect((await at('/demo/main.mjs', { Cookie: 'lazydoor_preview=wrong' })).status).toBe(404);
    expect((await at('/demo/?preview=wrong')).headers.get('Set-Cookie')).toBeNull();
    expect((await at(`/demo/?preview=${TOKEN}`, {}, { ...hidden, DEMO_PREVIEW_TOKEN: '' })).status).toBe(404);
  });

  it('opens by itself at the open time, with no cookie', async () => {
    expect((await at('/demo/', {}, { ...hidden, DEMO_OPENS_AT: '2000-01-01T00:00:00Z' })).status).toBe(200);
  });

  it('can be opened early, and hidden again, with the admin key', async () => {
    const admin = (open: boolean) => app.request('/admin/demo-open', { method: 'POST', headers: { Authorization: 'Bearer adm', 'Content-Type': 'application/json' }, body: JSON.stringify({ open }) }, hidden);
    expect(await (await admin(true)).json()).toEqual({ demoOpen: true });
    expect((await at('/demo/')).status).toBe(200);
    expect(await (await admin(false)).json()).toEqual({ demoOpen: false });
    expect((await at('/demo/')).status).toBe(404);
  });

  it('leaves the API, MCP, discovery and health as they are', async () => {
    for (const path of ['/health', '/v1/rules', '/v1/reason-codes', '/openapi.json', '/.well-known/agent-gateway.json', '/.well-known/jwks.json', '/v1/audit/verify']) expect((await at(path)).status, path).toBe(200);
    expect((await at('/v1/quotes/q1')).status).toBe(401);
  });
});

describe('/demo (the animated demo page, Workers static assets)', () => {
  it('redirects /demo to /demo/', async () => {
    const r = await get('/demo');
    expect(r.status).toBe(301);
    expect(r.headers.get('Location')).toBe('/demo/');
  });

  it('serves the page at /demo/ and its relative files under /demo/', async () => {
    const page = await get('/demo/');
    expect(page.status).toBe(200);
    expect(page.headers.get('Content-Type')).toContain('text/html');
    expect(await page.text()).toContain('<script type="module" src="main.mjs">');
    const js = await get('/demo/main.mjs');
    expect(js.status).toBe(200);
    expect(js.headers.get('Content-Type')).toContain('javascript');
    for (const path of ['/demo/scene.mjs', '/demo/kit/iso-kit.mjs', '/demo/compare.mjs', '/demo/fixtures/story-v2.json', '/demo/assets/fonts/Geist-Variable.woff2', '/demo/assets/sfx/rewind.mp3', '/demo/inside.mjs', '/demo/inside-view.mjs', '/demo/try.mjs', '/demo/try-view.mjs', '/demo/deck-view.mjs', '/demo/acceptance-view.mjs', '/demo/deck.json', '/demo/acceptance.json', '/demo/assets/deck/01.webp', '/demo/assets/stills/held.webp', '/demo/assets/proof/agent-run-poster.webp', '/demo/assets/logos/cloudflare.svg'])
      expect((await get(path)).status, path).toBe(200);
  });

  it('serves the Inside tab proof: proof.json and the agent-run video, seekable', async () => {
    const proof = await get('/demo/proof.json');
    expect(proof.headers.get('Content-Type')).toContain('application/json');
    expect(await proof.json()).toMatchObject({ acceptance: { confirmed: true }, agentRun: { src: 'assets/proof/agent-run.mp4' } });
    const video = await get('/demo/assets/proof/agent-run.mp4', { Range: 'bytes=0-1023' });
    expect(video.status).toBe(206);
    expect(video.headers.get('Content-Type')).toContain('video/mp4');
    expect((await video.arrayBuffer()).byteLength).toBe(1024);
  });

  it('answers a Range request for the narration with 206, so the player can seek', async () => {
    const r = await get('/demo/assets/voice/01.mp3', { Range: 'bytes=0-99' });
    expect(r.status).toBe(206);
    expect(r.headers.get('Content-Range')).toMatch(/^bytes 0-99\/\d+$/);
    expect((await r.arrayBuffer()).byteLength).toBe(100);
    const size = Number(r.headers.get('Content-Range')!.split('/')[1]);
    const tail = await get('/demo/assets/voice/01.mp3', { Range: 'bytes=100-' });
    expect([tail.status, tail.headers.get('Content-Range')]).toEqual([206, `bytes 100-${size - 1}/${size}`]);
    expect((await (await get('/demo/assets/voice/01.mp3', { Range: 'bytes=-10' })).arrayBuffer()).byteLength).toBe(10);
    expect((await get('/demo/assets/voice/01.mp3', { Range: `bytes=${size}-` })).status).toBe(416);
    expect((await get('/demo/assets/voice/01.mp3')).status).toBe(200);
  });

  it('publishes only what the page needs', async () => {
    for (const path of ['/demo/dev/fake-gateway.mjs', '/demo/test/live.test.mjs', '/demo/test/inside.test.mjs', '/demo/test/try.test.mjs', '/demo/dev/fake-gateway.mjs', '/demo/shots/after-scene.png', '/demo/SCRIPT.md', '/demo/STATUS.md', '/demo/story.mp4', '/demo/.assetsignore'])
      expect((await get(path)).status, path).toBe(404);
  });

  it('leaves the API routes as they were', async () => {
    const health = await get('/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true });
    expect((await get('/v1/rules')).headers.get('Content-Type')).toContain('application/json');
    expect((await get('/openapi.json')).status).toBe(200);
    expect((await get('/v1/quotes/q1')).status).toBe(401);
    const missing = await get('/nope');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: 'NOT_FOUND' });
  });
});
