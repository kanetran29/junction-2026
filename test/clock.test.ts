import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { helsinkiIso, now, replayOn, setClock } from '../src/clock';
import type { Env } from '../src/env';
import app from '../src/index';
import { db } from '../src/db';

const e = env as unknown as Env;
const demo = { ...e, DEMO_MODE: '1' };
const live = { ...e, DEMO_MODE: '0' };

describe('clock', () => {
  afterEach(async () => {
    await setClock(demo, null);
    await db(e).prepare("DELETE FROM settings WHERE key = 'replay'").run();
  });

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
    await db(e).prepare("INSERT INTO settings(key,value) VALUES('replay','1')").run();
    expect(await replayOn(demo)).toBe(true);
  });

  it('setClock rejects an ISO string without Z or an explicit offset', async () => {
    await expect(setClock(demo, '2026-11-15T17:05')).rejects.toThrow();
    await expect(setClock(demo, '2026-11-15T17:05:00+02:00')).resolves.toBeUndefined();
  });

  it('GET /health reads the clock: now in +02:00, replay off before the switch-over', async () => {
    await setClock(demo, '2026-11-13T19:10:00Z');
    const res = await app.fetch(new Request('http://x/health'), { ...demo, GEMINI_API_KEY: undefined });
    expect(await res.json()).toEqual({
      ok: true,
      now: '2026-11-13T21:10:00+02:00',
      replay: false,
      models: { gemini: false },
      store: 'postgres',
    });
  });

  it('GET /health reports gemini true when a key is set', async () => {
    const res = await app.fetch(new Request('http://x/health'), { ...demo, GEMINI_API_KEY: 'dummy' });
    expect(((await res.json()) as { models: { gemini: boolean } }).models.gemini).toBe(true);
  });
});
