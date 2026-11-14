import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { createApp } from '../src/http/routes';

const e = env as unknown as Env;
const app = createApp(async () => {
  throw new Error('the demo page makes no Valio call');
});
const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers }, e);

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
    for (const path of ['/demo/scene.mjs', '/demo/kit/iso-kit.mjs', '/demo/compare.mjs', '/demo/fixtures/story-v2.json', '/demo/assets/fonts/Geist-Variable.woff2', '/demo/assets/sfx/rewind.mp3'])
      expect((await get(path)).status, path).toBe(200);
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
    for (const path of ['/demo/dev/fake-gateway.mjs', '/demo/test/live.test.mjs', '/demo/shots/after-scene.png', '/demo/SCRIPT.md', '/demo/STATUS.md', '/demo/story.mp4', '/demo/.assetsignore'])
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
