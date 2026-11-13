import type { Env } from './env';

const REPLAY_FROM = Date.parse('2026-11-15T15:00:00Z');

/**
 * Reads one row of the key/value `settings` table (clock override, replay flag, recording, variant).
 */
async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

/**
 * The gateway's current time: the D1-stored override when DEMO_MODE is "1" and one is set, else real time.
 * Every cutoff, expiry and replay decision reads this, so demos can run on a scripted clock.
 */
export async function now(env: Env): Promise<Date> {
  if (env.DEMO_MODE === '1') {
    const override = await getSetting(env, 'clock');
    if (override) return new Date(override);
  }
  return new Date();
}

/**
 * Sets (ISO string) or clears (null) the demo clock override; the override only takes effect when DEMO_MODE is "1".
 */
export async function setClock(env: Env, iso: string | null): Promise<void> {
  if (iso === null) {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'clock'").run();
    return;
  }
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) throw new Error(`invalid clock: ${iso}`);
  await env.DB.prepare("INSERT INTO settings(key, value) VALUES('clock', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(t.toISOString())
    .run();
}

/**
 * Whether replay mode (serve recorded Valio replies) is on: the settings row `replay` = "1" forces it,
 * otherwise it is on once now() reaches 2026-11-15T15:00:00Z.
 */
export async function replayOn(env: Env): Promise<boolean> {
  if ((await getSetting(env, 'replay')) === '1') return true;
  return (await now(env)).getTime() >= REPLAY_FROM;
}

/**
 * Formats a date as Helsinki local time with the fixed `+02:00` offset used in every reply
 * (e.g. 2026-11-13T21:10:00+02:00); Helsinki is +02:00 throughout this event, so no DST handling is needed.
 */
export function helsinkiIso(d: Date): string {
  return new Date(d.getTime() + 2 * 3600_000).toISOString().replace(/\.\d{3}Z$/, '+02:00');
}
