import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { helsinkiIso, now, replayOn, setClock } from '../src/clock';
import type { Env } from '../src/env';
import app from '../src/index';

const e = env as unknown as Env;
const demo = { ...e, DEMO_MODE: '1' };
const live = { ...e, DEMO_MODE: '0' };

describe('clock', () => {
  it('now returns the override in demo mode', async () => {
    await setClock(demo, '2026-11-15T15:05:00Z');
    expect((await now(demo)).toISOString()).toBe('2026-11-15T15:05:00.000Z');
  });

  it('now follows real time after setClock(null)', async () => {
    await setClock(demo, '2026-11-15T15:05:00Z');
    await setClock(demo, null);
    expect(Math.abs((await now(demo)).getTime() - Date.now())).toBeLessThan(5000);
  });

  it('ignores the override when DEMO_MODE is 0', async () => {
    await setClock(demo, '2026-11-15T15:05:00Z');
    expect(Math.abs((await now(live)).getTime() - Date.now())).toBeLessThan(5000);
    await setClock(demo, null);
  });

  it('helsinkiIso uses the fixed +02:00 offset', () => {
    expect(helsinkiIso(new Date('2026-11-13T19:10:00Z'))).toBe('2026-11-13T21:10:00+02:00');
  });

  it('replay is on from 2026-11-15T15:00:00Z, or when the settings row says so', async () => {
    await setClock(demo, '2026-11-15T14:59:59Z');
    expect(await replayOn(demo)).toBe(false);
    await setClock(demo, '2026-11-15T15:00:00Z');
    expect(await replayOn(demo)).toBe(true);
    await setClock(demo, '2026-11-13T19:10:00Z');
    expect(await replayOn(demo)).toBe(false);
    await e.DB.prepare("INSERT INTO settings(key,value) VALUES('replay','1')").run();
    expect(await replayOn(demo)).toBe(true);
    await e.DB.prepare("DELETE FROM settings WHERE key='replay'").run();
    await setClock(demo, null);
  });

  it('GET /health reports ok, now, replay and gemini', async () => {
    const res = await app.fetch(new Request('http://x/health'), { ...e, DEMO_MODE: '0' });
    const body = (await res.json()) as { ok: boolean; now: string; replay: boolean; models: { gemini: boolean } };
    expect(body.ok).toBe(true);
    expect(body.replay).toBe(false);
    expect(body.models.gemini).toBe(false);
    expect(body.now).toMatch(/\+02:00$/);
  });
});
